// Planet 3D 뚜르비용 — planet-deco.js 가 붙인다. 규칙·박자는 tourbillon-core.mjs(순수).
//  · 메인(TourbMain) = 자이로 플라잉 뚜르비용. 위계: ① 프레임(스틸 브리지 — 아래 케이지 테 + 위로 휘어 정수리 보스로 모이는 팔 3,
//    면취 단면이라 모서리마다 하이라이트) ② 기어(고정 4번 휠 금 60 톱니·투각 살 5 → 케이지에 달린 스틸 피니언 10 톱니가 그 위를 구르고,
//    같은 굴대의 이스케이프 휠(갈고리 톱니 15)과 앵커(루비 팔레트 둘)가 박마다 째깍) ③ 밸런스(안쪽 기운 케이지 속 금 테·살 4·나사 10,
//    블루 스틸 브레게 오버코일 헤어스프링). 행성 몸체는 코어로 줄여(planet-deco 의 uShrink) 무브먼트가 앞에 선다.
//  · 재질: 간단한 환경맵(PMREM, 테마별 — 다크 = 어두운 방의 소프트박스 띠, 라이트 = 흰 스튜디오의 진한 띠)으로 금속 반사,
//    가장자리 항(다크 = 은은한 림라이트, 라이트 = 진한 잉크 윤곽)으로 실루엣을 세운다.
//  · 서브(SubCages): 같은 계열 단순형(스틸 케이지 테 + 브리지 팔 3 + 금 톱니 테 + 루비·블루)을 장면 전체 InstancedMesh 하나로.
//  · 지오메트리는 한 번만 만들어 모든 노드가 같이 쓴다(BufferGeometryUtils 없이 직접 합침 — importmap SRI 목록을 늘리지 않음).
import * as THREE from 'three';
import { TOURB_GEO as TG, GEAR_M, PINION_R, ESC_ARBOR, pinionAngle } from './tourbillon-core.mjs';
import { PHEAT, warmOf } from './planet-heat-core.mjs'; // 과열 곡선(30% 기준)

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
    if (!p.g.attributes.normal) p.g.computeVertexNormals();
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
/** 방위 a(케이지 좌표, 위에서 반시계) → 수평면 방향. three 의 rotation.y 와 같은 감각: (cos a, 0, −sin a) */
const dirA = (a, r, y = 0) => new THREE.Vector3(Math.cos(a) * r, y, -Math.sin(a) * r);

// ---------- 면취(앵글라주) 단면 스윕 ----------
/** 모서리를 깎은 직사각형 단면(폭 w × 두께 h, 깎기 c) — 반시계 */
function chamfer(w, h, c) {
  const x = w / 2, y = h / 2;
  return [[-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]];
}
/** 단면 prof([u, v])를 경로 frame(t) → {p, U, V}(위치·단면 u 축·v 축) 를 따라 쓸어 만든 관. 면마다 평평한 법선(면취 하이라이트) */
function sweep(prof, frame, segs, closed = false) {
  const n = prof.length, pos = [], nor = [];
  const F = [];
  for (let i = 0; i <= segs; i++) F.push(frame(closed ? (i % segs) / segs : i / segs));
  const P = (f, k) => f.p.clone().addScaledVector(f.U, prof[k][0]).addScaledVector(f.V, prof[k][1]);
  for (let i = 0; i < segs; i++) {
    const a = F[i], b = F[i + 1];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const du = prof[k2][0] - prof[k][0], dv = prof[k2][1] - prof[k][1];
      const nu = dv, nv = -du; // 단면 변의 바깥 법선(반시계 단면)
      const na = a.U.clone().multiplyScalar(nu).addScaledVector(a.V, nv).normalize();
      const nb = b.U.clone().multiplyScalar(nu).addScaledVector(b.V, nv).normalize();
      const p1 = P(a, k), p2 = P(a, k2), p3 = P(b, k2), p4 = P(b, k);
      for (const [p, q] of [[p1, na], [p2, na], [p3, nb], [p1, na], [p3, nb], [p4, nb]]) { pos.push(p.x, p.y, p.z); nor.push(q.x, q.y, q.z); }
    }
  }
  if (!closed) for (const [f, s] of [[F[0], -1], [F[segs], 1]]) { // 끝 마개
    const t = new THREE.Vector3().crossVectors(f.U, f.V).multiplyScalar(s);
    for (let k = 1; k < n - 1; k++) for (const kk of s > 0 ? [0, k, k + 1] : [0, k + 1, k]) { const p = P(f, kk); pos.push(p.x, p.y, p.z); nor.push(t.x, t.y, t.z); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
/** 수평 고리(반지름 R, 높이 y): 단면 u = 바깥(반지름), v = 위 */
const ringFrame = (R, y) => (t) => { const a = t * TAU; const U = dirA(a, 1); return { p: dirA(a, R, y), U, V: new THREE.Vector3(0, 1, 0) }; };
/** 브리지 팔: 방위 a 의 세로 평면에서 3차 베지어 (r, y) — 단면 u = 방위 접선(팔 폭), v = 평면 안 바깥 법선(두께) */
function archFrame(a, P0, C1, C2, P1) {
  const B = (t, i) => { const u = 1 - t; return u * u * u * P0[i] + 3 * u * u * t * C1[i] + 3 * u * t * t * C2[i] + t * t * t * P1[i]; };
  const W = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)); // 방위 접선
  return (t) => {
    const r = B(t, 0), y = B(t, 1), e = 1e-3, t2 = Math.min(1, t + e), t1 = Math.max(0, t - e);
    const dr = B(t2, 0) - B(t1, 0), dy = B(t2, 1) - B(t1, 1), L = Math.hypot(dr, dy) || 1;
    const nr = dy / L, ny = -dr / L; // 평면 안 법선(바깥쪽)
    return { p: dirA(a, r, y), U: W, V: dirA(a, nr, 0).add(new THREE.Vector3(0, ny, 0)).normalize() };
  };
}

// ---------- 기어 ----------
/** 톱니 윤곽(평 톱니): Z 톱니, 이뿌리 rr·이끝 rt, 이끝 폭 비율 */
function gearOutline(path, Z, rr, rt, tipW = 0.42, rootW = 0.56, phase = 0) {
  const p = TAU / Z;
  for (let i = 0; i < Z; i++) {
    const a = phase + i * p;
    const r0 = a - (rootW * p) / 2, r1 = a + (rootW * p) / 2, t0 = a - (tipW * p) / 2, t1 = a + (tipW * p) / 2;
    const pt = (ang, r) => [Math.cos(ang) * r, Math.sin(ang) * r];
    const seq = [pt(r0, rr), pt(t0, rt), pt(t1, rt), pt(r1, rr), pt(a + p / 2, rr * 0.995)];
    seq.forEach(([x, y], k) => (i === 0 && k === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  }
  path.closePath();
}
/** 이스케이프 휠 갈고리 톱니: 앞으로 기운 뾰족한 이 + 등 쪽 완만한 곡선 */
function escOutline(path, Z, rr, rt) {
  const p = TAU / Z;
  for (let i = 0; i < Z; i++) {
    const a = i * p;
    const pts = [[a, rr], [a + p * 0.18, rr + (rt - rr) * 0.55], [a + p * 0.42, rt], [a + p * 0.36, rt - (rt - rr) * 0.22], [a + p * 0.62, rr + (rt - rr) * 0.12], [a + p, rr]];
    pts.forEach(([ang, r], k) => { const x = Math.cos(ang) * r, y = Math.sin(ang) * r; (i === 0 && k === 0 ? path.moveTo(x, y) : path.lineTo(x, y)); });
  }
  path.closePath();
}
/** 투각 살: n 살(폭 sw) 사이 창 — rIn～rOut */
function spokeHoles(shape, n, rIn, rOut, sw, phase = 0) {
  for (let i = 0; i < n; i++) {
    const a0 = phase + (i * TAU) / n, a1 = phase + ((i + 1) * TAU) / n;
    const h = new THREE.Path();
    const S = 10;
    for (let k = 0; k <= S; k++) { const ao = sw / 2 / rOut; const a = a0 + ao + ((a1 - a0 - 2 * ao) * k) / S; const x = Math.cos(a) * rOut, y = Math.sin(a) * rOut; k ? h.lineTo(x, y) : h.moveTo(x, y); }
    for (let k = S; k >= 0; k--) { const ai = sw / 2 / rIn; const a = a0 + ai + ((a1 - a0 - 2 * ai) * k) / S; h.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn); }
    h.closePath();
    shape.holes.push(h);
  }
}
function circleHole(shape, r, x = 0, y = 0) { const h = new THREE.Path(); h.absarc(x, y, r, 0, TAU, true); shape.holes.push(h); }
/** 모양을 두께 d 로 압출(면취 베벨) → 수평(xz)으로 눕히고 두께 가운데를 y = 0 에 */
function extrudeFlat(shape, d, bevel = 0.01) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -d / 2);
  g.rotateX(-Math.PI / 2); // 모양 (x, y) → 세계 (x, ·, −y): 방위 감각이 dirA 와 같음
  return g.index ? g.toNonIndexed() : g;
}

function geo() {
  if (G) return G;
  const steelC = [1, 1, 1];
  const yRim = TG.CAGE_Y, yTop = TG.CAGE_TOP;
  // ① 바깥 케이지 프레임: 아래 테(넓은 면취 띠) + 브리지 팔 3(정수리 보스로 모임) + 이스케이프 브리지
  const rimProf = chamfer(0.13, 0.065, 0.018);
  const armProf = chamfer(0.085, 0.05, 0.014);
  const frame = [{ g: sweep(rimProf, ringFrame(TG.CAGE_R, yRim), 96, true) }];
  const armA = [];
  for (let i = 0; i < TG.CAGE_ARMS; i++) {
    const a = (i * TAU) / TG.CAGE_ARMS; armA.push(a);
    frame.push({ g: sweep(armProf, archFrame(a, [TG.CAGE_R, yRim + 0.02], [TG.CAGE_R + 0.12, yRim + 0.55], [0.75, yTop + 0.12], [0.1, yTop]), 28) });
  }
  // 정수리 보스(케이지 위 굴대 자리) — 면취 고리
  frame.push({ g: sweep(chamfer(0.07, 0.06, 0.014), ringFrame(0.12, yTop), 28, true) });
  // 이스케이프 브리지: 테에서 피니언 굴대까지 바깥으로 뻗는 짧은 팔(위)
  const aE = Math.PI / TG.CAGE_ARMS; // 두 팔 사이
  const yE = yRim + 0.075;
  frame.push({ g: sweep(chamfer(0.075, 0.04, 0.012), (t) => { const r = TG.CAGE_R + (ESC_ARBOR - TG.CAGE_R) * t; return { p: dirA(aE, r, yE), U: new THREE.Vector3(Math.sin(aE), 0, Math.cos(aE)), V: new THREE.Vector3(0, 1, 0) }; }, 4) });
  frame.push({ g: sweep(chamfer(0.06, 0.04, 0.012), ringFrame(0.06, 0), 20, true), m: at(...dirA(aE, ESC_ARBOR, yE).toArray()) });
  // 앵커 받침(브리지에서 갈라진 작은 팔)
  const aP = aE - 0.21, rP = ESC_ARBOR - 0.22;
  frame.push({ g: sweep(chamfer(0.06, 0.035, 0.01), (t) => { const r = TG.CAGE_R + (rP - TG.CAGE_R) * t; return { p: dirA(aP, r, yE), U: new THREE.Vector3(Math.sin(aP), 0, Math.cos(aP)), V: new THREE.Vector3(0, 1, 0) }; }, 3) });

  // ② 고정 4번 휠(금): 60 톱니, 투각 살 5, 허브(코어 둘레)
  const m4 = GEAR_M, R4 = TG.FOURTH_R;
  const s4 = new THREE.Shape(); gearOutline(s4, TG.FOURTH_Z, R4 - 1.25 * m4, R4 + m4);
  spokeHoles(s4, TG.FOURTH_SPOKES, 0.66, R4 - 1.25 * m4 - 0.1, 0.075, 0.3);
  circleHole(s4, 0.5);
  const fourth = extrudeFlat(s4, 0.05, 0.009);
  // 4번 휠 받침 나사(허브 위 3)
  // 피니언(스틸 10 톱니) + 굴대
  const sp = new THREE.Shape(); gearOutline(sp, TG.PINION_Z, PINION_R - 1.25 * m4, PINION_R + m4, 0.36, 0.5);
  circleHole(sp, 0.025);
  const pinion = merge([{ g: extrudeFlat(sp, 0.07, 0.008) }, { g: new THREE.CylinderGeometry(0.022, 0.022, yE - TG.FOURTH_Y + 0.06, 10), m: at(0, (yE + TG.FOURTH_Y) / 2 - TG.FOURTH_Y, 0) }]);
  // 이스케이프 휠(스틸, 갈고리 15, 살 5)
  const se = new THREE.Shape(); escOutline(se, TG.ESC_TEETH, TG.ESC_R * 0.74, TG.ESC_R);
  spokeHoles(se, 5, 0.05, TG.ESC_R * 0.74 - 0.035, 0.03);
  const esc = extrudeFlat(se, 0.03, 0.006);
  // 앵커(팔레트 레버): 피벗 기준 지역 좌표(x = 휠 쪽). 두 팔 + 포크 대(코어 쪽)
  const lev = new THREE.Shape();
  const LP = [[0.24, 0.12], [0.06, 0.03], [-0.2, 0.025], [-0.24, 0.05], [-0.27, 0], [-0.24, -0.05], [-0.2, -0.025], [0.06, -0.03], [0.24, -0.12], [0.2, -0.145], [0.03, -0.06], [-0.0, 0], [0.03, 0.06], [0.2, 0.145]];
  LP.forEach(([x, y], k) => (k ? lev.lineTo(x, y) : lev.moveTo(x, y))); lev.closePath();
  circleHole(lev, 0.018);
  const pallet = extrudeFlat(lev, 0.026, 0.005);
  const stone = new THREE.BoxGeometry(0.045, 0.03, 0.03);
  const palletStones = merge([{ g: stone, m: at(0.235, 0, -0.13).multiply(M().makeRotationY(0.5)) }, { g: stone, m: at(0.235, 0, 0.13).multiply(M().makeRotationY(-0.5)) }]);

  // ③ 안쪽 케이지(기운 축): 면취 고리 + 위를 넘는 아치 + 피벗 보스
  const inProf = chamfer(0.055, 0.04, 0.011);
  const inner = merge([
    { g: sweep(inProf, ringFrame(TG.INNER_R, 0), 72, true) },
    { g: sweep(chamfer(0.05, 0.035, 0.01), archFrame(0, [TG.INNER_R, 0.02], [TG.INNER_R, 0.55], [0.45, 0.62], [0, 0.62]), 16) },
    { g: sweep(chamfer(0.05, 0.035, 0.01), archFrame(Math.PI, [TG.INNER_R, 0.02], [TG.INNER_R, 0.55], [0.45, 0.62], [0, 0.62]), 16) },
    ...[1, -1].map((s) => ({ g: new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12), m: at(0, 0, s * TG.INNER_R).multiply(M().makeRotationX(Math.PI / 2)) })),
  ]);
  // 밸런스 휠(금): 면취 테 + 살 4 + 나사 10
  const balRim = merge([
    { g: sweep(chamfer(0.06, 0.08, 0.016), ringFrame(TG.BAL_R, 0), 80, true) },
    ...Array.from({ length: TG.BAL_ARMS }, (_, i) => ({ g: new THREE.BoxGeometry(TG.BAL_R * 2, 0.03, 0.045), m: M().makeRotationY((i * Math.PI) / TG.BAL_ARMS) })),
  ]);
  const scr = merge([{ g: new THREE.CylinderGeometry(0.016, 0.016, 0.05, 8), m: M().makeRotationZ(Math.PI / 2) }, { g: new THREE.SphereGeometry(0.026, 10, 6, 0, TAU, 0, Math.PI / 2), m: at(0.025, 0, 0).multiply(M().makeRotationZ(-Math.PI / 2)) }]);
  const balScrews = merge(Array.from({ length: TG.BAL_SCREWS }, (_, i) => { const a = ((i + 0.5) * TAU) / TG.BAL_SCREWS; return { g: scr, m: M().makeRotationY(a).multiply(at(TG.BAL_R + 0.03, 0, 0)) }; }));
  // 헤어스프링: 블루 스틸 평면 나선 + 브레게 오버코일(바깥 끝이 솟아 안쪽으로 굽음)
  const hp = [];
  const TURNS = 7, r0 = 0.035, r1 = 0.2;
  for (let i = 0; i <= 260; i++) { const u = i / 260, a = u * TURNS * TAU, r = r0 + (r1 - r0) * u; hp.push(new THREE.Vector3(Math.cos(a) * r, 0, -Math.sin(a) * r)); }
  for (let i = 1; i <= 30; i++) { const u = i / 30, a = TURNS * TAU + u * 2.2, r = r1 - 0.09 * Math.sin(u * Math.PI * 0.5), y = 0.045 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5); hp.push(new THREE.Vector3(Math.cos(a) * r, y, -Math.sin(a) * r)); }
  const hair = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), 290, 0.0042, 4, false);
  // 보석(루비)·나사(블루): 납작한 원판 + 돔
  const jewelG = merge([{ g: new THREE.CylinderGeometry(0.04, 0.04, 0.016, 14) }, { g: new THREE.SphereGeometry(0.03, 12, 6, 0, TAU, 0, Math.PI / 2), m: at(0, 0.006, 0) }]);
  const screwG = merge([{ g: new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12) }, { g: new THREE.SphereGeometry(0.03, 12, 5, 0, TAU, 0, Math.PI / 2), m: at(0, 0.008, 0).multiply(M().makeScale(1, 0.5, 1)) }]);
  const up = (p) => at(p.x, p.y, p.z);
  const oj = [up(new THREE.Vector3(0, yTop + 0.04, 0)), up(dirA(aE, ESC_ARBOR, yE + 0.03)), up(dirA(aP, rP, yE + 0.025))];
  const os = [];
  for (const a of armA) os.push(up(dirA(a, TG.CAGE_R, yRim + 0.04)));
  for (const a of armA) os.push(up(dirA(a + Math.PI / 3, 0.12, yTop + 0.035)));
  os.push(up(dirA(aE + 0.12, TG.CAGE_R + 0.02, yRim + 0.04)));
  // 4번 휠 받침 블루 나사 3(허브)
  for (let i = 0; i < 3; i++) os.push(up(dirA(0.3 + (i * TAU) / 3 + Math.PI / TG.FOURTH_SPOKES, 0.58, TG.FOURTH_Y + 0.03)));

  // 서브 단일 케이지(정점색: 스틸·금·루비·블루) — 테 + 팔 3 + 금 톱니 테 + 정수리 루비 + 블루 3
  const S = [0.9, 0.92, 0.96], GD = [1.0, 0.78, 0.38], RB = [0.8, 0.08, 0.18], BL = [0.25, 0.4, 1.0];
  const subParts = [{ g: sweep(chamfer(0.12, 0.06, 0.016), ringFrame(TG.SUB_R, -0.22), 56, true), c: S }];
  for (let i = 0; i < TG.SUB_ARMS; i++) { const a = (i * TAU) / TG.SUB_ARMS; subParts.push({ g: sweep(chamfer(0.08, 0.045, 0.013), archFrame(a, [TG.SUB_R, -0.2], [TG.SUB_R + 0.1, 0.55], [0.8, 1.18], [0.08, 1.16]), 16), c: S }); }
  const sg = new THREE.Shape(); gearOutline(sg, 40, TG.SUB_R + 0.06, TG.SUB_R + 0.15); circleHole(sg, TG.SUB_R - 0.04);
  subParts.push({ g: extrudeFlat(sg, 0.04, 0.007), m: at(0, -0.34, 0), c: GD });
  subParts.push({ g: sweep(chamfer(0.06, 0.05, 0.012), ringFrame(0.1, 1.16), 18, true), c: S });
  subParts.push({ g: jewelG, m: at(0, 1.2, 0), c: RB });
  for (let i = 0; i < TG.SUB_ARMS; i++) subParts.push({ g: screwG, m: up(dirA((i * TAU) / TG.SUB_ARMS, TG.SUB_R, -0.18)), c: BL });

  G = {
    frame: merge(frame), aE, aP, rP, yE,
    fourth, pinion, esc, pallet, palletStones,
    jewels: merge(oj.map((m) => ({ g: jewelG, m }))),
    screws: merge(os.map((m) => ({ g: screwG, m }))),
    inner, innerJewels: merge([1, -1].map((s) => ({ g: jewelG, m: at(0, 0, s * (TG.INNER_R + 0.04)).multiply(M().makeRotationX(s * Math.PI / 2)) }))),
    balRim, balScrews, hair,
    sub: merge(subParts, true),
  };
  return G;
}

// ---------- 환경맵(테마별 한 번) ----------
const ENV = {};
/** 다크 = 어두운 방 + 차가운 소프트박스 띠 몇 개(모서리에 가는 하이라이트), 라이트 = 흰 스튜디오 + 진한 띠(정밀 인쇄 같은 대비) */
export function tourbEnv(renderer, L) {
  const key = L ? 'L' : 'D';
  if (ENV[key] !== undefined) return ENV[key];
  if (!renderer) return null;
  try {
    const sc = new THREE.Scene();
    const bg = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
    const P = bg.geometry.attributes.position, col = new Float32Array(P.count * 3);
    const top = new THREE.Color(L ? 0xf4f6fa : 0x1a2130), bot = new THREE.Color(L ? 0x8a919c : 0x05070b), c = new THREE.Color();
    for (let i = 0; i < P.count; i++) { const k = P.getY(i) / 10 * 0.5 + 0.5; c.copy(bot).lerp(top, Math.pow(k, 0.8)); col.set([c.r, c.g, c.b], i * 3); }
    bg.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sc.add(bg);
    const box = (w, h, x, y, z, color, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m); };
    if (L) { // 흰 바탕에 진한 띠 — 금속 면마다 또렷한 명암
      box(16, 1.6, 0, 3.2, -8, 0x1b2230, 1); box(16, 1.2, 0, -1.5, 8, 0x1b2230, 1); box(1.4, 14, 8, 0, 0, 0x2a3242, 1); box(5, 3, -6, 6, 4, 0xffffff, 1.6);
    } else { // 어두운 방 — 위 소프트박스·옆 차가운 림 띠·따뜻한 반사판
      box(6, 2.4, 0, 8, -3, 0xffffff, 2.6); box(1.0, 12, -8, 1, 2, 0x9fc4ff, 1.8); box(1.0, 12, 8, 0, -2, 0xffffff, 1.2); box(8, 1.2, 2, -2, 8, 0xffd9a8, 0.6);
    }
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(sc, 0.03);
    pm.dispose();
    sc.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    ENV[key] = rt.texture;
  } catch (e) { ENV[key] = null; }
  return ENV[key];
}

// ---------- 가장자리 항(다크 = 림라이트, 라이트 = 잉크 윤곽) ----------
function rimInject(mat, U, extraKey = '') {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimCol; uniform float uRim; uniform float uInk;')
      .replace('#include <opaque_fragment>', `{
  float fr = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
  float rim = pow(fr, 3.0);
  outgoingLight += uRimCol * rim * uRim;
  outgoingLight *= 1.0 - uInk * smoothstep(0.55, 0.95, fr);
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'tourb-rim' + extraKey;
}
const rimU = () => ({ uRimCol: { value: new THREE.Color() }, uRim: { value: 0 }, uInk: { value: 0 } });
function setRim(U, L, col) {
  if (L) { U.uRim.value = 0; U.uInk.value = 0.55; }
  else { U.uRim.value = 0.55; U.uInk.value = 0; U.uRimCol.value.copy(col); }
}

const _c = new THREE.Color();
/** 테마별 금속 색. 다크 = 밝은 로듐·샴페인 금, 라이트 = 한 단 어두운 강철·짙은 금(밝은 바탕에서 윤곽이 서게) */
export function tourbColors(L) {
  return L ? { steel: 0x7c8696, gold: 0xa77d2c, ruby: 0xa3102e, blue: 0x1f3fb8, hair: 0x2445b0, rim: 0x000000 }
    : { steel: 0xc3ccd8, gold: 0xd9b064, ruby: 0xd0183f, blue: 0x3a64f0, hair: 0x5a82ff, rim: 0x9ec2ff };
}

/** 메인 자이로 뚜르비용 부품 묶음(노드 그룹의 몸체 크기 묶음 root 아래) */
export class TourbMain {
  constructor(root, renderer = null) {
    const g = geo();
    this.renderer = renderer;
    this.U = rimU();
    const std = (o, key) => { const m = new THREE.MeshStandardMaterial({ transparent: true, ...o }); rimInject(m, this.U, key); return m; };
    this.mSteel = std({ roughness: 0.22, metalness: 0.92 }, 's');
    this.mFrame = std({ roughness: 0.26, metalness: 0.9 }, 'f');
    this.mGold = std({ roughness: 0.26, metalness: 0.95 }, 'g');
    this.mRuby = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.06, metalness: 0.2 });
    this.mBlue = std({ roughness: 0.2, metalness: 0.8 }, 'b');
    this.mHair = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.3, metalness: 0.7 });
    this.mats = [this.mSteel, this.mFrame, this.mGold, this.mRuby, this.mBlue, this.mHair];
    this.group = new THREE.Group(); this.group.scale.setScalar(1.12); root.add(this.group); // 메인은 서브보다 한 치수 크게(주인공)
    const mesh = (geom, mat, parent) => { const o = new THREE.Mesh(geom, mat); parent.add(o); return o; };
    // ② 고정 4번 휠(케이지 밖, 돌지 않음)
    this.fourth = mesh(g.fourth, this.mGold, this.group); this.fourth.position.y = TG.FOURTH_Y;
    // ① 바깥 케이지(세로축)
    this.outer = new THREE.Group(); this.group.add(this.outer);
    this.frame = mesh(g.frame, this.mFrame, this.outer);
    this.screws = mesh(g.screws, this.mBlue, this.outer);
    this.jewels = mesh(g.jewels, this.mRuby, this.outer);
    // 피니언(4번 휠 높이) + 이스케이프 휠(브리지 아래) — 같은 굴대, 케이지와 함께 돌며 4번 휠 위를 구름
    this.arbor = new THREE.Group(); this.arbor.position.copy(dirA(g.aE, ESC_ARBOR, 0)); this.outer.add(this.arbor);
    this.pinion = mesh(g.pinion, this.mSteel, this.arbor); this.pinion.position.y = TG.FOURTH_Y;
    this.esc = mesh(g.esc, this.mSteel, this.arbor); this.esc.position.y = g.yE - 0.06;
    // 앵커: 피벗 = 앵커 받침 끝, 지역 x 가 이스케이프 휠 쪽을 향함
    this.palletG = new THREE.Group(); this.palletG.position.copy(dirA(g.aP, g.rP, g.yE - 0.06)); this.outer.add(this.palletG);
    const toEsc = dirA(g.aE, ESC_ARBOR, 0).sub(dirA(g.aP, g.rP, 0));
    this.palletBase = Math.atan2(-toEsc.z, toEsc.x);
    this.pallet = new THREE.Group(); this.palletG.add(this.pallet);
    mesh(g.pallet, this.mSteel, this.pallet); mesh(g.palletStones, this.mRuby, this.pallet);
    const sx = toEsc.length() - 0.235; this.pallet.children.forEach((o) => { o.position.x = sx; }); // 팔레트 돌이 휠 테두리에 닿게
    // ③ 안쪽 케이지(기운 축, 바깥과 반대로 더 빠르게) → 그 안의 밸런스
    this.innerTilt = new THREE.Group(); this.innerTilt.rotation.x = TG.INNER_TILT; this.outer.add(this.innerTilt);
    this.inner = new THREE.Group(); this.innerTilt.add(this.inner);
    this.innerM = mesh(g.inner, this.mSteel, this.inner);
    this.innerJ = mesh(g.innerJewels, this.mRuby, this.inner);
    this.bal = new THREE.Group(); this.inner.add(this.bal);
    this.balRim = mesh(g.balRim, this.mGold, this.bal);
    this.balScrews = mesh(g.balScrews, this.mGold, this.bal);
    this.hair = mesh(g.hair, this.mHair, this.inner); this.hair.position.y = 0.5;
    // LOD 묶음: 1 = 실루엣(프레임·4번 휠), 2 = 기어 트레인·안쪽 케이지·밸런스 테, 3 = 잔부품
    this.lv2 = [this.arbor, this.innerTilt, this.balScrews, this.palletG];
    this.lv3 = [this.screws, this.jewels, this.innerJ, this.hair, this.balScrews, this.palletG];
    this.group.traverse((o) => { if (o.isMesh || o.isLine) o.raycast = () => {}; });
    this.lod = -1; this._key = ''; this.aE = g.aE;
  }
  theme(L, nodeColor) {
    const key = L + '|' + nodeColor.getHexString();
    if (key === this._key) return; this._key = key;
    const C = tourbColors(L), env = tourbEnv(this.renderer, L);
    for (const m of this.mats) { m.envMap = env; m.envMapIntensity = L ? 1.0 : 1.6; m.needsUpdate = true; }
    // 프레임 스틸은 세션 색을 아주 조금(어울리게), 기어 금·루비·블루는 고정 — 정밀 기계의 재질감
    this.mFrame.color.set(C.steel).lerp(nodeColor, 0.08); this.mFrame.emissive.copy(nodeColor).multiplyScalar(L ? 0 : 0.03);
    this.mSteel.color.set(C.steel).multiplyScalar(L ? 0.92 : 0.95);
    this.mGold.color.set(C.gold); this.mGold.emissive.set(C.gold).multiplyScalar(L ? 0.0 : 0.06);
    this.mRuby.color.set(C.ruby); this.mRuby.emissive.set(C.ruby).multiplyScalar(L ? 0.3 : 0.6); this.mRuby.envMapIntensity = 2.2;
    this.mBlue.color.set(C.blue); this.mBlue.emissive.set(C.blue).multiplyScalar(L ? 0.1 : 0.3);
    this.mHair.color.set(C.hair); this.mHair.emissive.set(C.hair).multiplyScalar(L ? 0.1 : 0.35);
    setRim(this.U, L, _c.set(C.rim).lerp(nodeColor, 0.25));
    this._fE = this.mFrame.emissive.clone(); this._gE = this.mGold.emissive.clone(); this._sE = this.mSteel.emissive.clone(); // 과열 기준값
    if (this._heat) { const h = this._heat; this._heat = 0; this.heat(h, L); }
  }
  /** 과열(0..1): 프레임·금·강철 부품 발광이 주황 → 빨강으로 달아오름(테마 기준값 위에 더함). 같은 값이면 아무것도 안 함 */
  heat(h, L) {
    h = Math.max(0, Math.min(1, h || 0));
    if (h === (this._heat || 0) || !this._fE) { this._heat = h; return; }
    this._heat = h;
    const k = h <= 0 ? 0 : warmOf(h) * (L ? 0.35 : 0.6); // planet-heat-core 데움 곡선(30% 아주 옅게 → 70% 꽉)
    const t = Math.max(0, Math.min(1, (h - PHEAT.RGB_LO) / (PHEAT.RGB_HI - PHEAT.RGB_LO))), r = 1, g = 0.55 - 0.35 * t, b = 0.16 - 0.09 * t;
    const add = (m, base, w) => m.emissive.setRGB(base.r + r * w, base.g + g * w, base.b + b * w);
    add(this.mFrame, this._fE, k); add(this.mGold, this._gE, k * 0.8); add(this.mSteel, this._sE, k * 0.45);
  }
  /** es = Escapement 값, lod = tourbLod, op = 몸체 투명도 */
  step(es, lod, op) {
    if (lod !== this.lod) {
      this.lod = lod; this.group.visible = lod >= 1;
      for (const o of this.lv2) o.visible = lod >= 2;
      for (const o of this.lv3) o.visible = lod >= 3;
    }
    if (lod < 1) return;
    this.outer.rotation.y = es.cage;
    if (lod >= 2) {
      // 피니언·이스케이프 휠(같은 굴대): 4번 휠과 맞물린 각 + 째깍 반동
      this.arbor.rotation.y = pinionAngle(es.cage, this.aE) + es.kick;
      this.inner.rotation.y = es.cage2;
      this.bal.rotation.y = es.bal;
      if (lod >= 3) {
        this.pallet.rotation.y = this.palletBase + es.pallet + es.kick * 0.6;
        this.hair.rotation.y = es.bal * 0.65;
        const br = 1 + 0.1 * Math.sin(es.bal); this.hair.scale.set(br, 1, br); // 헤어스프링이 감기고 풀림
      }
    }
    for (const m of this.mats) { m.opacity = op; m.depthWrite = op >= 0.99; }
  }
  dispose() { this.group.removeFromParent(); for (const m of this.mats) m.dispose(); }
}

/** 서브 단일 케이지 — 장면 전체 InstancedMesh 하나. begin() → put(...) × n → end() */
export class SubCages {
  constructor(scene, cap = 256, renderer = null) {
    const g = geo();
    this.cap = cap; this.renderer = renderer;
    this.op = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    const geom = g.sub.clone(); geom.setAttribute('aOp', this.op);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.88, transparent: true });
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOp;\nvarying float vOp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = aOp;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vOp;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vOp;');
    };
    this.U = rimU();
    rimInject(this.mat, this.U, '-sub');
    this.mesh = new THREE.InstancedMesh(geom, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.raycast = () => {};
    scene.add(this.mesh);
    this.n = 0; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.tint = new THREE.Color(1, 1, 1);
  }
  theme(L) {
    this.tint.set(L ? 0x8790a0 : 0xc0c8d4);
    this.mat.emissive.set(L ? 0x000000 : 0x0c1018);
    this.mat.envMap = tourbEnv(this.renderer, L); this.mat.envMapIntensity = L ? 0.9 : 1.1; this.mat.needsUpdate = true;
    setRim(this.U, L, _c.set(0x9ec2ff));
    if (L) this.U.uInk.value = 0.45; else this.U.uRim.value = 0.4;
  }
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
