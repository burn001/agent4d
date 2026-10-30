// 흐름(Flow) 3D 메인 몸 — 반응로 코어 · 데이터 띠 기둥. 순수 값은 main-rig-core.mjs · shape-core.mjs.
// 메인은 많아야 수십이라 메인마다 작은 무리(Group)를 둔다. 도형(기하)은 모듈에 한 벌만 만들어 모든 메인이 나눠 쓰고, 재질만 메인별(상태·세션 색).
// 노드 자리·크기는 SceneView 가 정한 group.position · mesh.scale 을 그대로 따르고(등장·퇴장·숨김 포함), 투명도는 칩 패스가 계산한 v._alphaK.
// 컨텍스트 게이지는 몸 안에 통합: 반응로 = 기둥 여섯이 차오름(한 기둥 ≈ 17%), 기둥 = 유리 안 액체 높이. 예전 칩 둘레 고리는 메인에 없다.
// 데이터 기둥 띠 글 = 실제 최근 도구 이름·대상(v.hist — 서버가 redact, privacy minimal 이면 도구 이름만), 도구 중 가운데 띠 = 지금 도구(호박색).
import * as THREE from 'three';
import { MAIN_RIG, mainLook } from './main-rig-core.mjs';
import { assignMainShapes, mainSetSig, ctxFrac, ctxTone, reactorFills, bandWords, toolBand } from './shape-core.mjs';
import { nodeVisualStateAt, paletteOf, stateColor, NODE_STATE } from './flow-style.mjs';
import { heatColor, heatPulse } from './heat-fx-core.mjs'; // 과열 물듦

const R = MAIN_RIG.R, CC = MAIN_RIG.C;
const HEXA = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i; return [Math.sin(a), Math.cos(a)]; }); // 꼭짓점이 ±z(CylinderGeometry 6각과 같은 방위)

/** 위치·법선만 있는 기하를 하나로(비색인), extra(i, geo) = 정점별 덧속성 값 */
function merge(geos, extraName = null, extraOf = null) {
  const pos = [], nor = [], ex = [];
  geos.forEach((g0, gi) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position').array, n = g.getAttribute('normal');
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    if (n) for (let i = 0; i < n.array.length; i++) nor.push(n.array[i]);
    if (extraName) for (let i = 0; i < p.length / 3; i++) ex.push(extraOf(gi));
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (extraName) out.setAttribute(extraName, new THREE.Float32BufferAttribute(ex, 1));
  return out;
}
/** 바닥과 나란한 육각 띠(y = 0), per = 변마다 마디, dash = 마디 중 채움 */
function hexBand(rIn, rOut, per = 1, dash = 1) {
  const pos = [];
  for (let a = 0; a < 6; a++) {
    const b = (a + 1) % 6, P = (r, t) => [(HEXA[a][0] + (HEXA[b][0] - HEXA[a][0]) * t) * r, (HEXA[a][1] + (HEXA[b][1] - HEXA[a][1]) * t) * r];
    for (let k = 0; k < per; k++) {
      const t0 = k / per, t1 = t0 + dash / per, o0 = P(rOut, t0), o1 = P(rOut, t1), n0 = P(rIn, t0), n1 = P(rIn, t1);
      pos.push(o0[0], 0, o0[1], n0[0], 0, n0[1], o1[0], 0, o1[1], o1[0], 0, o1[1], n0[0], 0, n0[1], n1[0], 0, n1[1]);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}
const hexLoop = (r) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(HEXA.flatMap(([x, z]) => [x * r, 0, z * r]), 3)); return g; };

let G = null; // 공용 기하(한 벌)
function geos() {
  if (G) return G;
  const cyl = (rt, rb, h, seg = 6, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const pil = HEXA.map(([x, z]) => cyl(R.pillar, R.pillar, R.frameH).translate(x * R.frame, 0, z * R.frame));
  const fills = HEXA.map(([x, z]) => cyl(R.fill, R.fill, 1, 6, true).translate(x * R.frame, 0.5, z * R.frame));
  const liq = cyl(CC.shell * 0.95, CC.shell * 0.95, 1); liq.translate(0, 0.5, 0);
  G = {
    plate: cyl(R.plate, R.plate * 1.05, R.plateH), plateBand: hexBand(R.plate * 0.84, R.plate * 0.96), plateDash: hexBand(R.plate * 0.84, R.plate * 0.96, 4, 0.55),
    frame: hexLoop(R.frame), frameIn: hexLoop(R.frame * 0.9), cap: hexBand(R.frame * 0.9, R.frame),
    pillars: merge(pil), fills: merge(fills, 'aI', (i) => i),
    core: new THREE.IcosahedronGeometry(R.core, 0), wire: new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R.wire, 1)),
    gyro: R.gyro.map((r) => new THREE.TorusGeometry(r, 0.014, 6, 56)),
    cPlate: cyl(CC.plate, CC.plate * 1.05, CC.plateH), spine: cyl(CC.spine, CC.spine, CC.colH),
    shell: cyl(CC.shell, CC.shell, CC.colH, 6, true), shellEdge: new THREE.EdgesGeometry(cyl(CC.shell, CC.shell, CC.colH)),
    liquid: liq, surf: hexBand(CC.shell * 0.8, CC.shell * 0.95),
    band: cyl(CC.band, CC.band, CC.bandH, 6, true), cCap: cyl(CC.plate * 0.97, CC.plate * 0.92, CC.capH), cBorder: hexBand(CC.plate * 0.78, CC.plate * 0.9),
    icon: new THREE.PlaneGeometry(1.05, 1.05).rotateX(-Math.PI / 2),
    pts4: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)),
  };
  return G;
}
let TEX = null;
function texs() {
  if (TEX || typeof document === 'undefined') return TEX;
  const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  TEX = {
    glow: cv(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }),
    star: cv(128, 128, (x) => { x.fillStyle = '#fff'; x.translate(64, 64); x.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, r = i % 2 ? 9 : 46; i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill(); }),
  };
  return TEX;
}

// 기둥 채움: 기둥 번호 aI 와 높이(0..1)로 컨텍스트만큼만(uLevel 0..6)
const FILL_VS = `attribute float aI; varying float vI; varying float vY; void main() { vI = aI; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FILL_FS = `uniform float uLevel; uniform vec3 uCol; uniform float uA; varying float vI; varying float vY;
void main() { float f = clamp(uLevel - vI, 0.0, 1.0); if (vY > f) discard; gl_FragColor = vec4(uCol, uA * (0.55 + 0.45 * vY / max(f, 0.05))); }`;

/** 띠 글 텍스처(반복 가로 흐름) */
function bandTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(1.6, 1); t.colorSpace = THREE.SRGBColorSpace;
  return { c, x: c.getContext('2d'), t, key: '' };
}
function drawBand(B, words, glyphs) {
  const key = words.join('\u0001') + '|' + glyphs;
  if (B.key === key) return false;
  B.key = key;
  const { x, c } = B, w = c.width, h = c.height;
  x.clearRect(0, 0, w, h);
  x.fillStyle = '#fff'; x.font = '600 34px "JetBrains Mono", D2Coding, Consolas, ui-monospace, monospace'; x.textBaseline = 'middle';
  const list = words.length ? words : ['▮▯▮▮▯', '▯▮▮'];
  let px = 12;
  for (let k = 0; px < w; k++) {
    const s = list[k % list.length];
    x.globalAlpha = 1; x.fillText(s, px, h / 2 + 2); px += x.measureText(s).width + 26;
    if (glyphs) { x.globalAlpha = 0.5; x.fillText('▸', px, h / 2 + 2); px += 40; }
    if (k > 40) break;
  }
  x.globalAlpha = 1;
  B.t.needsUpdate = true;
  return true;
}

export class MainRigs {
  constructor(scene, view) {
    this.scene = scene; this.view = view;
    this.rigs = new Map(); // id → rig
    this.shapes = new Map(); this._sig = '';
    this.isLight = false;
    this._c = new THREE.Color(); this._c2 = new THREE.Color(); this._v = new THREE.Vector3();
    this._fills = new Array(6);
  }
  applyTheme(isLight) {
    this.isLight = !!isLight;
    for (const r of this.rigs.values()) this._themeRig(r);
  }
  /** id → 'reactor' | 'column' (assignMainShapes, 메인 집합이 바뀔 때만 다시) */
  shapeOf(id) { return this.shapes.get(id) || null; }
  _assign() {
    const mains = [];
    for (const v of this.view.vis.values()) if (v.kind === 'main' && !v.device) mains.push({ id: v.id, projectId: v.projectId ?? v.node.projectId ?? null, status: v.node.status, startedAt: v.node.startedAt });
    const sig = mainSetSig(mains);
    if (sig === this._sig) return;
    this._sig = sig;
    this.shapes = assignMainShapes(mains);
  }
  _mat(kind, o = {}) {
    const add = o.add;
    const m = kind === 'basic' ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: !add, side: o.side || THREE.FrontSide, ...(o.map ? { map: o.map } : {}) })
      : kind === 'line' ? new THREE.LineBasicMaterial({ transparent: true, depthWrite: false })
        : kind === 'points' ? new THREE.PointsMaterial({ transparent: true, depthWrite: false, size: 0.2, map: texs() ? texs().glow : null, sizeAttenuation: true })
          : new THREE.MeshStandardMaterial({ transparent: true, metalness: o.metal ?? 0.45, roughness: o.rough ?? 0.5, flatShading: true, ...(o.glass ? { opacity: 0.16, depthWrite: false, side: THREE.DoubleSide } : {}) });
    m.userData.add = !!add || kind === 'line' || kind === 'points';
    m.userData.base = o.op ?? 1;
    return m;
  }
  _themeRig(r) {
    const L = this.isLight;
    for (const m of r.mats) {
      if (m.userData.add) { m.blending = L ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true; }
    }
    for (const m of r.body) m.color.set(L ? '#c9d2e0' : '#141d42');
    if (r.glass) r.glass.color.set(L ? '#7d93c4' : '#1a2a66');
  }
  _build(v, shape) {
    const g = geos(), T = texs();
    const grp = new THREE.Group(); grp.name = 'main-rig';
    const r = { id: v.id, shape, grp, mats: [], body: [], parts: {}, ga: [0, 0], sparkT: 0 };
    const mk = (geo, mat, Ctor = THREE.Mesh) => { const o = new Ctor(geo, mat); o.raycast = () => {}; o.frustumCulled = false; grp.add(o); if (!r.mats.includes(mat)) r.mats.push(mat); return o; };
    const body = () => { const m = this._mat('std'); r.body.push(m); return m; };
    if (shape === 'reactor') {
      const B0 = -MAIN_RIG.BOTTOM, B = B0 + R.plateH;
      const P = r.parts;
      P.plate = mk(g.plate, body()); P.plate.position.y = B0 + R.plateH / 2;
      P.band = mk(g.plateBand, this._mat('basic', { add: true, side: THREE.DoubleSide })); P.band.position.y = B + 0.004;
      P.dash = mk(g.plateDash, P.band.material); P.dash.position.y = B + 0.004;
      const lm = this._mat('line');
      P.frame = mk(g.frame, lm, THREE.LineLoop); P.frame.position.y = B + R.frameH;
      P.frameIn = mk(g.frameIn, lm, THREE.LineLoop); P.frameIn.position.y = B + R.frameH;
      P.cap = mk(g.cap, this._mat('basic', { add: true, side: THREE.DoubleSide, op: 0.35 })); P.cap.position.y = B + R.frameH;
      P.pillars = mk(g.pillars, body()); P.pillars.position.y = B + R.frameH / 2;
      const fm = new THREE.ShaderMaterial({ uniforms: { uLevel: { value: 0 }, uCol: { value: new THREE.Color() }, uA: { value: 0.9 } }, vertexShader: FILL_VS, fragmentShader: FILL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      fm.userData.add = true; fm.userData.base = 1;
      P.fills = mk(g.fills, fm); P.fills.position.y = B; P.fills.scale.y = R.frameH;
      const cm = new THREE.MeshStandardMaterial({ color: 0x05070f, emissive: 0x66ccff, emissiveIntensity: 1, metalness: 0.2, roughness: 0.55, flatShading: true, transparent: true });
      P.core = mk(g.core, cm); P.core.position.y = B + R.frameH / 2;
      P.wire = mk(g.wire, this._mat('line'), THREE.LineSegments); P.wire.position.y = P.core.position.y;
      if (T) { const sm = new THREE.SpriteMaterial({ map: T.glow, transparent: true, depthWrite: false }); sm.userData.add = true; sm.userData.base = 1; r.mats.push(sm); P.glow = new THREE.Sprite(sm); P.glow.raycast = () => {}; P.glow.position.y = P.core.position.y; P.glow.scale.setScalar(1.25); grp.add(P.glow); }
      const gm = this._mat('basic', { add: true, side: THREE.DoubleSide });
      P.gyro = g.gyro.map((geo) => { const o = mk(geo, gm); o.position.y = P.core.position.y; return o; });
      P.sparks = mk(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(36), 3)), this._mat('points'), THREE.Points);
      r.coreY = P.core.position.y;
    } else {
      const B0 = -MAIN_RIG.BOTTOM, B = B0 + CC.plateH, P = r.parts;
      P.plate = mk(g.cPlate, body()); P.plate.position.y = B0 + CC.plateH / 2;
      P.spine = mk(g.spine, body()); P.spine.position.y = B + CC.colH / 2;
      const glass = this._mat('std', { glass: true, metal: 0.1, rough: 0.1 }); r.glass = glass;
      P.shell = mk(g.shell, glass); P.shell.position.y = B + CC.colH / 2;
      P.edge = mk(g.shellEdge, this._mat('line'), THREE.LineSegments); P.edge.position.y = P.shell.position.y;
      P.liquid = mk(g.liquid, this._mat('basic', { add: true, op: 0.14 })); P.liquid.position.y = B;
      P.surf = mk(g.surf, this._mat('basic', { add: true, side: THREE.DoubleSide }));
      r.bandTex = [bandTexture(), bandTexture()];
      P.bands = CC.bandY.map((yy, i) => { const m = this._mat('basic', { add: true, side: THREE.DoubleSide, map: r.bandTex[i === 1 ? 1 : 0] ? r.bandTex[i === 1 ? 1 : 0].t : null }); const o = mk(g.band, m); o.position.y = B + yy; return o; });
      const capY = B + CC.colH;
      P.cap = mk(g.cCap, body()); P.cap.position.y = capY + CC.capH / 2;
      P.border = mk(g.cBorder, this._mat('basic', { add: true, side: THREE.DoubleSide })); P.border.position.y = capY + CC.capH + 0.004;
      if (T) { P.icon = mk(g.icon, this._mat('basic', { add: true, map: T.star })); P.icon.position.y = capY + CC.capH + 0.008; }
      r.B = B; r.capY = capY;
    }
    // 생각 중 도는 점 넷(두 모양 공용)
    r.parts.dots = mk(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)), this._mat('points'), THREE.Points);
    v.group.add(grp);
    this._themeRig(r);
    return r;
  }
  _drop(r) {
    r.grp.removeFromParent();
    for (const m of r.mats) m.dispose();
    for (const k of ['sparks', 'dots']) if (r.parts[k]) r.parts[k].geometry.dispose();
    if (r.bandTex) for (const b of r.bandTex) if (b) b.t.dispose();
  }
  clear() { for (const r of this.rigs.values()) this._drop(r); this.rigs.clear(); this._sig = ''; }

  update(now) {
    const view = this.view;
    this._assign();
    const seen = new Set();
    const nowMs = view.clock ? view.clock() : Date.now();
    const reduced = !!view.reduced, L = this.isLight, P = paletteOf(L);
    const cam = view.camera, H = view.container.clientHeight || 1, f = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const dt = this._t0 != null ? Math.min(0.25, Math.max(0, now - this._t0)) : 0; this._t0 = now;
    for (const v of view.vis.values()) {
      if (v.kind !== 'main' || v.device) continue;
      const shape = this.shapes.get(v.id) || 'reactor';
      let r = this.rigs.get(v.id);
      if (r && (r.shape !== shape || r.grp.parent !== v.group)) { this._drop(r); r = null; }
      if (!r) { r = this._build(v, shape); this.rigs.set(v.id, r); }
      seen.add(v.id);
      const show = !v.gone && !v.hidden && v.group.visible;
      r.grp.visible = show;
      if (!show) continue;
      // 크기 = 칩과 같은 메시 배율, 투명도 = 칩 패스 값(퇴장·숨김 페이드·끝남 흐림)
      const s = Math.max(1e-4, v.mesh.scale.x);
      r.grp.scale.setScalar(s);
      r.grp.rotation.set(0, 0, 0);
      const a = Math.max(0, Math.min(1, v._alphaK ?? 1));
      const d = Math.max(0.01, v.group.position.distanceTo(cam.position));
      const px = (s * f) / d;
      const lod = px >= MAIN_RIG.LOD_PX;
      const st = nodeVisualStateAt(v.node, v.icons ? v.icons.size : 0, nowMs);
      const look = mainLook(st, now + (v.seed || 0), reduced);
      const sc = this._c.set(stateColor(st, L));
      // 과열: 코어·자이로·띠(상태색 자리)가 그리는 heat 만큼 주황 → 빨강으로 물듦(과열부터 맥동, 컨텍스트 채움 기둥은 그대로)
      const hk = v._heatK || 0;
      let hw = 0;
      if (hk) {
        const hr = heatColor(hk, L, this._hrgb || (this._hrgb = [0, 0, 0]));
        const pul = heatPulse(hk, now, v.seed || 0, reduced);
        // 2026-10-30 데움이 잘 보이게: 30% 0.32 → 40% ≈0.45 → 70% ≈0.66 → 85%↑ 0.77(예전 0.08 → 0.19 → 0.53 → 0.75)
        hw = (0.32 + 0.45 * Math.pow(Math.min(1, hk / 0.85), 0.7)) * (0.75 + 0.25 * pul);
        sc.lerp((this._hc || (this._hc = new THREE.Color())).setRGB(hr[0], hr[1], hr[2]), hw);
      }
      let sess = v.sessC && !v.node.parentId && !look.done && !look.err && !look.stop ? v.sessC : view.kindColor('main');
      if (hw) sess = (this._sc3 || (this._sc3 = new THREE.Color())).copy(sess).lerp(this._hc, Math.min(0.85, hw * 1.3)); // 틀·뚜껑·테두리도 호박 → 빨강으로(세션 색 위에)
      const dim = 1 - (v.tierDim || 0);
      for (const m of r.mats) {
        const base = m.userData.base ?? 1;
        if (m.isShaderMaterial) m.uniforms.uA.value = 0.85 * a; else m.opacity = base * a;
        if (!m.userData.add && m.depthWrite !== undefined && !(r.glass === m)) m.depthWrite = a > 0.9;
      }
      const ctx = ctxFrac(v.node), tone = ctx == null ? 0 : ctxTone(ctx);
      const cc = this._c2.set(tone === 0 ? P.holo : tone === 1 ? P.tool : P.error);
      const cpul = tone === 2 && !reduced ? 0.6 + 0.4 * Math.sin(now * 5) : 1;
      const Pp = r.parts;
      if (shape === 'reactor') {
        Pp.band.visible = !look.dashed; Pp.dash.visible = look.dashed;
        Pp.band.material.color.copy(sc).multiplyScalar(dim); Pp.band.material.opacity = (look.done ? 0.45 : 0.85) * look.pulse * a;
        Pp.frame.material.color.copy(sess); Pp.frame.material.opacity = 0.9 * a;
        Pp.cap.material.color.copy(sess); Pp.cap.material.opacity = 0.35 * a;
        const core = Pp.core.material;
        core.emissive.copy(sc); core.emissiveIntensity = L ? 0.5 + 0.4 * look.glow : 0.45 + 0.75 * look.glow; core.opacity = a;
        core.color.set(L ? sc : 0x05070f);
        const bob = reduced ? 0 : 0.035 * Math.sin(now * 1.5 + (v.seed || 0));
        const cy = r.coreY + bob;
        Pp.core.position.y = cy; Pp.wire.position.y = cy;
        if (!reduced && !look.done && !look.stop) { Pp.core.rotation.set(now * 0.3, now * (look.tool ? 1.6 : 0.5), 0); Pp.wire.rotation.set(-now * 0.2, -now * 0.35, 0); }
        Pp.wire.material.color.copy(sc); Pp.wire.material.opacity = 0.45 * a;
        if (Pp.glow) { Pp.glow.position.y = cy; Pp.glow.material.color.copy(sc); Pp.glow.material.opacity = (L ? 0.2 : 0.32) * look.glow * a; Pp.glow.visible = lod; }
        if (lod) { r.ga[0] += look.spin * dt; r.ga[1] -= look.spin * 0.8 * dt; }
        Pp.gyro[0].rotation.set(1.2 + r.ga[0] * 0.3, r.ga[0], 0.3); Pp.gyro[1].rotation.set(0.4, r.ga[1], 1.1 + r.ga[1] * 0.2);
        for (const o of Pp.gyro) { o.position.y = cy; o.material.color.copy(sc); o.material.opacity = (look.done || look.stop ? 0.2 : 0.8) * a; }
        // 컨텍스트: 기둥 여섯이 아래서 차오름
        const fm = Pp.fills.material;
        fm.uniforms.uLevel.value = ctx == null ? 0 : Math.max(0.04, ctx * 6);
        fm.uniforms.uCol.value.copy(cc); fm.uniforms.uA.value = 0.9 * a * cpul;
        // 불티(도구 중)
        const sp = Pp.sparks;
        sp.visible = look.sparks && lod;
        if (sp.visible) {
          const arr = sp.geometry.getAttribute('position').array;
          for (let i = 0; i < 12; i++) {
            const u = (now * 0.9 + i / 12) % 1, dx = Math.sin(i * 2.4), dy = Math.cos(i * 1.7) * 0.6, dz = Math.cos(i * 2.4), ln = Math.hypot(dx, dy, dz);
            const k = 0.28 + u * 0.85;
            arr[i * 3] = (dx / ln) * k; arr[i * 3 + 1] = cy + (dy / ln) * k; arr[i * 3 + 2] = (dz / ln) * k;
          }
          sp.geometry.getAttribute('position').needsUpdate = true;
          sp.material.color.set(P.tool); sp.material.size = 0.16 * s; sp.material.opacity = 0.9 * a;
        }
      } else {
        const lvl = Math.max(0.02, ctx ?? 0.02) * CC.colH;
        Pp.liquid.scale.y = lvl; Pp.liquid.material.color.copy(cc); Pp.liquid.material.opacity = (L ? 0.22 : 0.14) * a * cpul;
        Pp.surf.position.y = r.B + lvl + (reduced ? 0 : 0.012 * Math.sin(now * 2)); Pp.surf.material.color.copy(cc); Pp.surf.material.opacity = 0.9 * a;
        Pp.edge.material.color.copy(sess); Pp.edge.material.opacity = 0.7 * a;
        Pp.border.material.color.copy(sc); Pp.border.material.opacity = look.pulse * a * (look.done ? 0.5 : 1);
        if (Pp.icon) { Pp.icon.material.color.copy(view.kindColor('main')).lerp(sc, 0.35); Pp.icon.material.opacity = 0.9 * a; }
        // 띠 글: 바깥 둘 = 최근 도구(이력), 가운데 = 도구 중이면 지금 도구(호박), 아니면 최근 도구
        const words = bandWords(v.hist), cur = toolBand(v.icons);
        if (r.bandTex[0] && (now - (r.texAt || 0) > 1 / MAIN_RIG.TEX_FPS)) {
          r.texAt = now;
          drawBand(r.bandTex[0], words, false);
          drawBand(r.bandTex[1], cur ? [cur] : words, !!cur);
        }
        Pp.bands.forEach((o, i) => {
          const tool = i === 1 && look.tool && !!cur;
          o.material.color.copy(tool ? this._c.set(P.tool) : sc);
          o.material.opacity = (look.done ? 0.2 : tool ? 1 : look.act ? 0.7 : 0.4) * look.pulse * a;
          const map = o.material.map;
          if (map && lod) map.offset.x = (map.offset.x + dt * (i % 2 ? -1 : 1) * (tool ? 0.12 : look.scroll)) % 1;
        });
      }
      // 생각 중: 도는 점 넷(반응로는 코어 둘레, 기둥은 뚜껑 위)
      const dots = Pp.dots;
      dots.visible = look.think && lod && !reduced;
      if (dots.visible) {
        const arr = dots.geometry.getAttribute('position').array;
        const rr = shape === 'reactor' ? 0.7 : 1.08, yy = shape === 'reactor' ? r.coreY : r.capY + CC.capH + 0.05;
        for (let i = 0; i < 4; i++) { const an = now * 1.5 + i * Math.PI / 2; arr[i * 3] = Math.cos(an) * rr; arr[i * 3 + 1] = yy + (shape === 'reactor' ? Math.sin(an * 2 + i) * 0.06 : 0); arr[i * 3 + 2] = Math.sin(an) * rr; }
        dots.geometry.getAttribute('position').needsUpdate = true;
        dots.material.color.copy(sc); dots.material.size = 0.24 * s; dots.material.opacity = a;
      }
    }
    for (const [id, r] of this.rigs) if (!seen.has(id)) { this._drop(r); this.rigs.delete(id); }
  }
  /** 시험·확인용 요약 */
  debug() { const by = { reactor: 0, column: 0 }; for (const r of this.rigs.values()) by[r.shape]++; return by; }
  dispose() { this.clear(); }
}
export { NODE_STATE };
