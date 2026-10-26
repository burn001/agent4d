// 흐름(Flow) 표현의 연결선: 부모→자식으로 가늘어지는 곡선 빔(리본 메시 1개)
// agent-flow 의 tapered bezier: 시작이 굵고 끝이 가늘며 진행 방향 왼쪽으로 살짝 휜다. 작업 중인 자식으로 가는 빔은 밝고
// 겉에 넓고 옅은 글로우 빔을 하나 더. 끝난 자식은 거의 투명, 오류는 빨강. 카메라가 멀면 굵기를 키워 1px 아래로 사라지지 않게.
import * as THREE from 'three';
import { BEAM, FLOW_DASH, flowDash, beamControls, beamWidth, paletteOf, beamAlpha, packetGlow, beamY } from './flow-style.mjs';
import { linkPackets } from '../flow-core.mjs';
import { isGuessLink } from '../batch-core.mjs';
import { DEG, degOf, lineGap, lineFlicker, lineJitter } from '../degrade-core.mjs';
import { jobOf, jobCode } from '../job-core.mjs';
import { jobBeamStyle } from './job-chip-core.mjs'; // 주인 → 작업 빔은 은은하게

const SEG = BEAM.segments;
const VPR = (SEG + 1) * 2; // 리본 하나의 정점 수

function bez(t, a, b, c, d) { const m = 1 - t; return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d; }

export class Beams {
  constructor(scene, view) {
    this.view = view;
    this.cap = 0;
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    // 흐르는 혜성 대시(셰이더): 정점마다 부모에서 잰 길이 aS·흐름(aFlow = 속도, 밝기 배율) → 조각마다 uTime 으로 굴림. 객체 추가 없음
    this.uni = { uTime: { value: 0 }, uAdd: { value: 1 }, uGap: { value: FLOW_DASH.gap }, uSharp: { value: FLOW_DASH.sharp } };
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = [
        'attribute float aS;', 'attribute vec2 aFlow;', 'varying float vS;', 'varying vec2 vFlow;', '',
      ].join('\n') + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS; vFlow = aFlow;');
      sh.fragmentShader = [
        'uniform float uTime, uAdd, uGap, uSharp;', 'varying float vS;', 'varying vec2 vFlow;', '',
      ].join('\n') + sh.fragmentShader.replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'float ph = fract((vS - uTime * vFlow.x) / uGap);',
        'float fk = 1.0 + vFlow.y * pow(ph, uSharp) * step(0.001, vFlow.x);',
        'if (uAdd > 0.5) diffuseColor.rgb *= fk; else diffuseColor.a = min(1.0, diffuseColor.a * fk);',
      ].join('\n'));
    };
    this.mat.customProgramCacheKey = () => 'ccviz-beam-flow';
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // 칩 깊이 패스(1.5) 다음 — 노드 뒤 빔은 가려짐
    scene.add(this.mesh);
    this._ensure(512);
    this.P = paletteOf(false);
    this._c = { holo: new THREE.Color(), err: new THREE.Color(), stop: new THREE.Color(), bg: new THREE.Color(), tool: new THREE.Color() };
  }
  _ensure(n) {
    if (n <= this.cap) return;
    let cap = Math.max(512, this.cap);
    while (cap < n) cap *= 2;
    this.cap = cap;
    this.pos = new Float32Array(cap * VPR * 3);
    this.col = new Float32Array(cap * VPR * 4);
    this.sArr = new Float32Array(cap * VPR);
    this.flow = new Float32Array(cap * VPR * 2);
    const idx = new Uint32Array(cap * SEG * 6);
    for (let r = 0; r < cap; r++) for (let i = 0; i < SEG; i++) {
      const v = r * VPR + i * 2, o = (r * SEG + i) * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aS', new THREE.BufferAttribute(this.sArr, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aFlow', new THREE.BufferAttribute(this.flow, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  applyTheme(isLight, bg) {
    this.isLight = !!isLight;
    this.P = paletteOf(this.isLight);
    this._c.holo.set(this.P.holo); this._c.err.set(this.P.error); this._c.stop.set(this.P.stopped); this._c.tool.set(this.P.tool);
    this._c.bg.copy(bg);
    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (this.mat.blending !== blend) { this.mat.blending = blend; this.mat.needsUpdate = true; }
    this.uni.uAdd.value = this.isLight ? 0 : 1;
  }
  /** 리본 하나 쓰기: a(부모)→b(자식), 굵기 w0→w1, 색 c·불투명도 al. tEnd < 1 이면 곡선을 그 비율까지만(퇴장 때 자식 끝부터 감김) */
  _ribbon(r, a, b, w0, w1, c, al, tEnd = 1, dashed = false, es = null, fl = null, dg = 0, seed = 0) {
    const cp = beamControls(a, b);
    const P = this.pos, C = this.col, S = this.sArr, F = this.flow;
    let o = r * VPR * 3, q = r * VPR * 4, so = r * VPR, fo = r * VPR * 2;
    const fsp = fl ? fl.speed : 0, famp = fl ? fl.amp : 0;
    for (let i = 0; i < VPR; i++) { F[fo + i * 2] = fsp; F[fo + i * 2 + 1] = famp; }
    if (!cp) { for (let i = 0; i < VPR; i++) { P[o++] = a.x; P[o++] = a.y; P[o++] = a.z; C[q++] = 0; C[q++] = 0; C[q++] = 0; C[q++] = 0; S[so++] = 0; } return; }
    let sLen = 0, px = a.x, py = a.y, pz = a.z;
    // 다크(가산)는 알파를 색에 곱해 넣고, 라이트(일반)는 알파 채널로
    const add = !this.isLight;
    // 신호 열화(dg>0): 조각마다 끊김(거의 투명)·밝기 잡음·옆으로 흔들림. 움직임 줄이기면 고정 무늬(시각 0)
    const dt = DEG.reduced ? 0 : DEG.t, fk = dg > 0 ? lineFlicker(seed, dt, dg) : 1;
    // 높이 계층: 위층(부모) → 아래층(자식)으로 떨어지는 3D 곡선(beamY). 굵기 방향은 카메라를 향하게(접선 × 시선) — 수직 구간도 납작해지지 않게
    const cam = this.view.camera.position, lift = a.noLift ? 0 : cp.dist; // 세운 배치 장치 아래 변에서는 떠오르지 않고 곧장 내려감
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * tEnd;
      const x = bez(t, a.x, cp.c1x, cp.c2x, b.x), z = bez(t, a.z, cp.c1z, cp.c2z, b.z), y = beamY(t, a.y, b.y, lift);
      sLen += Math.hypot(x - px, y - py, z - pz); px = x; py = y; pz = z;
      S[so++] = sLen; S[so++] = sLen;
      const t2 = Math.min(1, t + 0.02), t1 = Math.max(0, t - 0.02);
      const tx = bez(t2, a.x, cp.c1x, cp.c2x, b.x) - bez(t1, a.x, cp.c1x, cp.c2x, b.x);
      const ty = beamY(t2, a.y, b.y, lift) - beamY(t1, a.y, b.y, lift);
      const tz = bez(t2, a.z, cp.c1z, cp.c2z, b.z) - bez(t1, a.z, cp.c1z, cp.c2z, b.z);
      // n = 접선 × (점 → 카메라), 정규화. 접선이 시선과 거의 나란하면 수평 법선으로
      const vx = cam.x - x, vy = cam.y - y, vz = cam.z - z;
      let nx = ty * vz - tz * vy, ny = tz * vx - tx * vz, nz = tx * vy - ty * vx;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-6) { nx = -tz; ny = 0; nz = tx; nl = Math.hypot(nx, nz) || 1; }
      const hw = beamWidth(t, w0, w1) / 2;
      nx *= hw / nl; ny *= hw / nl; nz *= hw / nl;
      const jj = dg > 0 ? lineJitter(seed, i, dt, dg) * 0.5 : 0, jl = jj / (hw || 1), jx = nx * jl, jy = ny * jl, jz = nz * jl;
      P[o++] = x + nx + jx; P[o++] = y + ny + jy; P[o++] = z + nz + jz;
      P[o++] = x - nx + jx; P[o++] = y - ny + jy; P[o++] = z - nz + jz;
      // 양 끝(노드 안쪽)은 옅게
      const edge = Math.min(1, t * 8, (tEnd - t) * 8 + (tEnd < 1 ? 0.6 : 0));
      // 추정 연결은 점선: 정점 두 개씩 켜고 끔
      // 패킷이 지나가는 구간만 잠깐 밝게
      let k = Math.min(1, al * (0.35 + 0.65 * edge) * (dashed && (i >> 1) % 2 ? 0.08 : 1) + (es ? packetGlow(t, es) * edge : 0));
      if (dg > 0) k *= lineGap(seed, i >> 1, dt, dg) ? 0.04 : fk;
      for (let j = 0; j < 2; j++) {
        if (add) { C[q++] = c.r * k; C[q++] = c.g * k; C[q++] = c.b * k; C[q++] = 1; }
        else { C[q++] = c.r; C[q++] = c.g; C[q++] = c.b; C[q++] = k; }
      }
    }
  }
  update() {
    const view = this.view;
    const L = view.links;
    this._ensure(L.length * 2);
    // 카메라가 멀면 굵기를 키움(약 1.5px 이상 유지)
    const camDist = view.focusDist || view.camera.position.length();
    const ws = Math.max(1, camDist / 38);
    let r = 0;
    const pk = view.flow && view.flow.pool ? linkPackets(view.flow.pool.active, performance.now() / 1000, (id) => { const v = view.vis.get(id); return v ? v.node.parentId : null; }) : null;
    for (let i = 0; i < L.length; i++) {
      const [cv, pv] = L[i];
      if (cv.gone || pv.gone) continue;
      const st = cv.node.status;
      const a = view.linkEnd ? view.linkEnd(pv, true) : pv.group.position, b = view.linkEnd ? view.linkEnd(cv, false) : cv.group.position; // 세운 장치 변
      let c = this._c.holo, al = beamAlpha(st, this.isLight, cv.stale), active = false; // 은은하게
      if (cv.sessC) c = cv.sessC; // 그 메인 서브트리 빔은 세션 색
      if (st === 'active') { active = true; if (cv.icons && cv.icons.size && !cv.sessC) c = this._c.tool; }
      else if (st === 'error') c = this._c.err;
      else if (st === 'stopped') c = this._c.stop;
      const sk = Math.min(cv.scopeK ?? 1, pv.scopeK ?? 1);
      // 퇴장 중: 빔은 자식 끝에서부터 부모 쪽으로 감겨 들어가며 조금씩 옅어진다(감기는 모습이 보이게 끝까지 다 지우지는 않음)
      const exiting = cv.exiting != null;
      const tEnd = exiting ? 1 - (cv._linkK || 0) : 1;
      if (exiting) al = Math.max(al, BEAM.idleAlpha * (this.isLight ? 1.6 : 1.2)); // 완료 빔(거의 투명)도 감기는 동안은 보이게
      al *= Math.min(1, sk * 1.2) * (exiting ? 0.35 + 0.65 * (cv.exitF ?? 1) : Math.min(cv.exitF ?? 1, 1));
      if (al < 0.01 || tEnd < 0.02) continue;
      const pulse = 1; // 맥동 없음(정보는 패킷 움직임으로)
      const dashed = isGuessLink(cv.node) || !!cv.procRig; // 띄운 노드 → 분리 프로세스 장치는 띄움 점선(떼어 띄운 관계)
      if (dashed && sk >= 0.5 && !exiting) al = Math.max(al, BEAM.idleAlpha * 1.6); // 점선은 비는 칸이 있어 조금 더 진하게
      const es = pk && sk >= 0.5 ? pk.get(pv.id + '|' + cv.id) : null;
      const dg = DEG.on ? degOf(cv.id) : 0, sd = dg > 0 ? (cv.seed * 1e6) | 0 : 0; // 그 세션 열화
      // 작업: 주인의 하위 정보라 가늘고 옅게, 색 = 작업 칩 색(표시 상태 — chips.update 가 보관한 값, 없으면 지금 시계로), 글로우 빔 없음
      const job = jobOf(cv.node);
      if (job) {
        const code = cv._jobChip ? cv._jobChip.code : jobCode(job, view.clock ? view.clock() : Date.now());
        const js = jobBeamStyle(code);
        if (view.chips) c = view.chips.jobColor(code);
        this._ribbon(r++, a, b, BEAM.startW * ws * js.widthK, BEAM.endW * ws * js.widthK, c, al * js.alphaK, tEnd, dashed, es, exiting || dashed || sk < 0.5 ? null : js.dash, dg, sd);
        continue;
      }
      this._ribbon(r++, a, b, BEAM.startW * ws, BEAM.endW * ws, c, al * pulse, tEnd, dashed, es, exiting || dashed || sk < 0.5 ? null : flowDash(st), dg, sd);
      if (active && !dashed) this._ribbon(r++, a, b, (BEAM.startW + BEAM.glowW) * ws, (BEAM.endW + BEAM.glowW * 0.4) * ws, c, BEAM.glowAlpha * (this.isLight ? 1.5 : 1) * (exiting ? cv.exitF ?? 1 : 1), tEnd, false, null, null, dg, sd);
    }
    this.geo.setDrawRange(0, r * SEG * 6);
    if (r) { const A = this.geo.attributes; A.position.needsUpdate = true; A.color.needsUpdate = true; A.aS.needsUpdate = true; A.aFlow.needsUpdate = true; }
    this.uni.uTime.value = view.reduced ? 0 : performance.now() / 1000;
    this.count = r;
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}
