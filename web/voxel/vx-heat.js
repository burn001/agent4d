// 복셀 과열 3D — 지친 직원 둘레의 김·연기·붉은 열기 글로우·땀방울·불티(규칙은 vx-heat-core.mjs, 몸짓·얼굴은 character.js).
//   반투명 덩이(김·연기·글로우 껍질)는 인스턴스 알파가 있는 공용 묶음 하나(HazeBatch, draw call 1 — 비면 숨김),
//   땀방울·불티는 기존 발광 묶음(dGlow)에 상자로. 상태 없는 입자(시각만으로 위치)라 버퍼·수명 관리가 없다.
import * as THREE from 'three';
import { UNIT_BOX } from './props.js';
import { TIRED, heatParticles, glowLevel, heatHueOf, floorHeatOf, farBoost } from './vx-heat-core.mjs';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color(), _hc = new THREE.Color(), _hw = new THREE.Vector3();

/** 반투명 상자 묶음(인스턴스마다 알파, 깊이 안 씀, 불투명·유리 뒤에 그림) */
export class HazeBatch {
  constructor(parent, cap = 256, key = 'ccviz-vx-haze') {
    this.parent = parent; this.n = 0; this.fade = null;
    const m = this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
    this.uInk = { value: 0 };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uInk = this.uInk;
      sh.vertexShader = 'attribute float iAlpha;\nvarying float vIAlpha;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIAlpha = iAlpha;');
      // 라이트 잉크(곱하기): premultiplied 색(rgb·a) → 흰 종이 위 잉크 1 - a + rgb·a
      sh.fragmentShader = 'uniform float uInk;\nvarying float vIAlpha;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vIAlpha;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (uInk > 0.5) gl_FragColor = vec4(vec3(1.0 - clamp(gl_FragColor.a, 0.0, 1.0)) + gl_FragColor.rgb, 1.0);');
    };
    m.customProgramCacheKey = () => key;
    this._alloc(cap);
  }
  _alloc(cap) {
    const old = this.mesh;
    const geo = UNIT_BOX.clone();
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAlpha', alpha);
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.renderOrder = 3;
    mesh.raycast = () => {};
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      mesh.instanceColor.array.set(old.instanceColor.array);
      alpha.array.set(this.alpha.array);
      old.removeFromParent(); old.geometry.dispose(); old.dispose();
    }
    if (this.parent) this.parent.add(mesh);
    this.mesh = mesh; this.alpha = alpha; this.cap = cap;
  }
  begin(fade) { this.n = 0; this.fade = fade || null; }
  /** 섞기: 다크 열기 글로우는 더하기(빛으로 읽히게), 라이트는 곱하기 잉크(흰 막이 아니라 붉게 물든 공기로), 그 밖은 보통 */
  setBlend(additive, ink = false) {
    const b = ink ? THREE.MultiplyBlending : additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.uInk.value = ink ? 1 : 0;
    if (this.material.blending !== b) { this.material.blending = b; this.material.premultipliedAlpha = !!ink; this.material.needsUpdate = true; }
  }
  /** 상자 하나: 가운데 (x,y,z), 크기, 색 c(THREE.Color), 알파 a, y축 회전 ry */
  box(x, y, z, sx, sy, sz, c, a, ry = 0) {
    if (this.fade) { const f = this.fade(x, z); if (f <= 0) return; a *= f; }
    if (a <= 0.004) return;
    if (this.n >= this.cap) this._alloc(this.cap * 2);
    const i = this.n++;
    if (ry) _q.setFromAxisAngle(_Y, ry); else _q.identity();
    _m.compose(_p.set(x, y, z), _q, _s.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz)));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceColor.setXYZ(i, c.r, c.g, c.b);
    this.alpha.array[i] = Math.min(1, a);
  }
  end() {
    const mesh = this.mesh, n = this.n;
    if (n || mesh.count) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; this.alpha.needsUpdate = true; }
    mesh.visible = n > 0;
  }
  dispose() { const m = this.mesh; if (m) { m.removeFromParent(); m.geometry.dispose(); m.dispose(); } this.material.dispose(); this.mesh = null; }
}

/** 테마별 색(라이트 = 진하게, 다크 = 밝게 — 바탕에서 보이게) */
function heatColors(isLight) {
  return {
    steam: new THREE.Color(isLight ? 0x8a93a6 : 0xdde3ee),
    smoke: new THREE.Color(isLight ? 0x23262e : 0x868b97), // 위험 = 짙은 연기 기둥(2026-10-30 더 어둡게 — 라이트 거의 검정, 다크 바닥보다 밝은 진회색)
    burst: new THREE.Color(isLight ? 0xa7b0c2 : 0xf2f5fa),
    breath: new THREE.Color(isLight ? 0x9aa6bd : 0xe6f0ff),
    heat: new THREE.Color(isLight ? 0xe0311f : 0xff3b2f),
    warm: new THREE.Color(isLight ? 0xe8850f : 0xffa63a), // 데움 호박(2026-10-30 주황과 구분되게 더 노랗게)
    sweat: new THREE.Color(isLight ? 0x2f8fe0 : 0x9fd8ff),
    ember: new THREE.Color(isLight ? 0xf05a14 : 0xffa040),
    ember2: new THREE.Color(isLight ? 0xd8321a : 0xff5a2a),
    flush: new THREE.Color(isLight ? 0xd8402e : 0xe0503c),
    under: new THREE.Color(isLight ? 0x6a4a5e : 0x3a2a3a),
    sweatDrop: new THREE.Color(isLight ? 0x5aaee8 : 0xb8e4ff),
  };
}

/** 3D 과열 연출(복셀 오피스마다 하나) */
export class VxHeat3D {
  constructor(scene, isLight = false) {
    this.haze = new HazeBatch(scene, 256);
    this.glow = new HazeBatch(scene, 512, 'ccviz-vx-heatglow'); // 붉은 열기(다크 = 더하기 빛, 라이트 = 곱하기 잉크)
    this.applyTheme(isLight);
    this._parts = Array.from({ length: TIRED.PART_CAP }, () => ({ type: '', x: 0, y: 0, z: 0, s: 0, a: 0, r: 0 }));
    this.fxN = 0;        // 이번 프레임 입자를 그린 직원 수(상한 FX_CAP)
    this.FX_CAP = 48;
  }
  applyTheme(isLight) { this.light = !!isLight; this.col = heatColors(this.light); this.glow.setBlend(!this.light, this.light); }
  /** fade = 프로젝트 페이드, cam = 카메라 위치(멀수록 바닥 원·김 덩이를 키움 — farBoost) */
  begin(fade, cam = null) { this.haze.begin(fade); this.glow.begin(fade); this.fxN = 0; this.cam = cam; }
  end() { this.haze.end(); this.glow.end(); }
  dispose() { this.haze.dispose(); this.glow.dispose(); }

  /**
   * 직원 한 명(drawCharacter 뒤). ch._heat(TiredBook), ch._headW(머리 가운데 세계 좌표, character.js 가 남김),
   * k = 등장·퇴장 배율, h = 키 배율. G = 발광 묶음(땀·불티). far = 먼 LOD(글로우 껍질만).
   */
  draw(ch, G, t, reduced, far = false) {
    const h = ch._heat;
    if (!h || !h.on || h.stage < 1) return;
    const C = this.col, H = this.haze;
    const k = ch.scale ? ch.scale(t) : 1;
    if (k <= 0.02) return;
    const x = ch.pos.x, z = ch.pos.z;
    const cam = this.cam, B = cam ? farBoost(Math.hypot(x - cam.x, cam.y, z - cam.z)) : 1; // 멀수록 큰 신호(2026-10-30)
    const hc = _hc.copy(C.warm).lerp(C.heat, heatHueOf(h)); // 단계색: 호박 → 주황 → 빨강
    const W = this.glow, L = this.light;
    // 몸 둘레 열기 껍질 두 겹(데움 옅은 호박 → 과열 주황 → 위험 붉은 맥동). 다크 = 더하기 빛, 라이트 = 곱하기 잉크
    const gl = glowLevel(h, t, reduced, ch.phase || 0);
    if (gl > 0) {
      const ga = L ? 1.6 : 0.8;
      W.box(x, 0.95 * k, z, 0.9 * k, 1.8 * k, 0.72 * k, hc, 0.08 * gl * ga, ch.yaw);
      W.box(x, 0.95 * k, z, 1.25 * k, 2.15 * k, 1.0 * k, hc, 0.04 * gl * ga, ch.yaw);
    }
    // 발밑 바닥 열기 원(2026-10-30 "멀리서도 단계가 보이게"): 겹친 판(가운데로 갈수록 짙은 계단 번짐, 0°·45° 두 장씩 = 팔각) + 테 고리.
    //  30% 부터 보이고 70%·90% 에서 한 단씩 진해지며 맥동이 빨라진다(움직임 줄이기면 고정). 카메라가 멀면 farBoost 만큼 커진다
    const fh = floorHeatOf(h, t, reduced, ch.phase || 0, this._fh || (this._fh = {}));
    if (fh.a > 0) {
      const R = fh.r * B * k, da = (L ? 0.2 : 0.16) * fh.a;
      for (let j = 0; j < 3; j++) {
        const fs = 2 * R * 0.78 * (1 - 0.3 * j), fy = 0.025 + 0.004 * j;
        W.box(x, fy, z, fs, 0.02, fs, hc, da, ch.yaw); W.box(x, fy, z, fs, 0.02, fs, hc, da, ch.yaw + 0.785);
      }
      const N = 20, th = 0.08 * B * k * fh.w, ra = (L ? 0.55 : 0.6) * fh.ring;
      for (let j = 0; j < fh.rings; j++) { // 위험 = 테 두 겹
        const Rj = R * (1 + 0.24 * j), seg = (2 * Math.PI * Rj / N) * 1.04;
        for (let i = 0; i < N; i++) { const an = (i / N) * Math.PI * 2; W.box(x + Math.cos(an) * Rj, 0.045, z + Math.sin(an) * Rj, seg, 0.025, th, hc, ra * (j ? 0.7 : 1), -an - Math.PI / 2); }
      }
    }
    if (this.fxN >= this.FX_CAP) return;
    this.fxN++;
    const n = heatParticles(h, ch.hash || 0, t, reduced, this._parts);
    if (!n) return;
    // 먼 LOD(두 상자)에도 머리 위 김·연기는 남긴다(머리 자리는 두 상자 기준 근사). 땀·불티는 가까이서만
    const hw = far || !ch._headW ? _hw.set(x, 1.72 * k, z) : ch._headW, top = hw.y + 0.25 * k * (far ? 1 : ch._bh || 1);
    const kB = k * B;
    const cy = Math.cos(ch.yaw), sy = Math.sin(ch.yaw);
    for (let i = 0; i < n; i++) {
      const p = this._parts[i];
      // 지역(x 오른쪽, z 앞) → 세계: 캐릭터는 yaw 로 돌고 앞이 +z
      const tiny = p.type === 'sweat' || p.type === 'ember';
      if (far && tiny) continue;
      const big = tiny ? k : kB; // 김·연기 덩이만 멀수록 키움
      const wx = hw.x + (p.x * cy + p.z * sy) * big, wz = hw.z + (-p.x * sy + p.z * cy) * big, wy = top + p.y * big;
      const s = p.s * big;
      switch (p.type) {
        case 'steam': H.box(wx, wy, wz, s, s, s, C.steam, p.a, p.r); break;
        case 'smoke': H.box(wx, wy, wz, s, s, s, C.smoke, p.a, p.r); break;
        case 'burst': H.box(wx, wy, wz, s, s * 1.4, s, C.burst, p.a, p.r); break;
        case 'breath': H.box(wx, wy, wz, s, s * 0.8, s, C.breath, p.a, p.r); break;
        case 'sweat': G.box(wx, wy, wz, s, s * 1.4, s, C.sweat); break;
        case 'ember': G.box(wx, wy, wz, s, s, s, (i & 1) ? C.ember : C.ember2, p.r || 0); break;
      }
    }
  }
}
