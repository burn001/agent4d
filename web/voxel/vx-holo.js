// 복셀 오피스 홀로그램 — Flow 홀로그램 패널과 같은 장부(HoloBook)·같은 글(HoloText)을
// 사무실 은유로: 직원이 작업 중이면 스탠딩 데스크 발광대에서 모니터가 떠오르고(가는 빛줄로 옆으로 퍼진 뒤 위아래로 열림)
// 안에 도구 이름·실제 출력 몇 줄이 흐른다. 도구 호출마다 모니터 위로 작은 창이 튀어나왔다 들어가고, 동시에 열린 다른 도구는
// 모니터 옆 작은 창으로 남는다. 일하는 손끝에서 모니터 아래 끝까지 가는 빛줄기. 대기 중이면 모니터가 접힌다.
// 기동기(복합기) 위에는 회차 진행·평균 시간 홀로그램 대시보드.
// 그리기: 틀 InstancedMesh 1개(셰이더 빌보드) + 손끝 빛줄 LineSegments 1개 + 글 평면 풀(HoloText, 내용이 바뀔 때만 다시 그림).
import * as THREE from 'three';
import { HOLO, PANEL, HoloBook, panelPx } from '../holo-core.mjs';
import { HoloText } from '../holo-text.js';
import { catColor } from '../flow-core.mjs';
import { MON, monitorWanted, stepOpen, openShape, popShape } from './office-core.mjs';
import { DESK_TOP } from './props.js';
import { deviceInfo, fmtDur, cycleProgress } from '../batch-core.mjs';
import { t as _t } from '../i18n.mjs';

const CAP = 320, THREAD_CAP = 160;

const VS = `
attribute vec3 iColor; attribute vec3 iFlash; attribute vec4 iA;
varying vec2 vUv; varying vec3 vCol; varying vec3 vFl; varying vec4 vA; varying vec2 vSz;
void main() {
  vUv = uv; vCol = iColor; vFl = iFlash; vA = iA;
  vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  vec2 sz = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vSz = sz;
  c.xy += position.xy * sz;
  gl_Position = projectionMatrix * c;
}`;
const FS = `
uniform float uTime; uniform float uLight;
varying vec2 vUv; varying vec3 vCol; varying vec3 vFl; varying vec4 vA; varying vec2 vSz;
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float asp = vSz.x / max(1e-4, vSz.y);
  vec2 P = vec2((vUv.x - 0.5) * asp, vUv.y - 0.5);
  float r = 0.045;
  float d = sdBox(P, vec2(asp * 0.5 - r, 0.5 - r)) - r;
  if (d > 0.0) discard;
  float edge = 1.0 - smoothstep(0.0, 0.035, -d);
  vec3 c = mix(vCol, vFl, vA.y);
  float kind = vA.z;
  float head = step(0.8, vUv.y) * step(kind, 1.5);
  float scan = 0.5 + 0.5 * sin(vUv.y * 160.0 - uTime * 5.0);
  // 글이 없는 패널(먼 거리·작은 창): 흐르는 코드 줄 무늬
  float lines = 0.0;
  if (vA.w < 0.5) {
    float rows = kind > 0.5 && kind < 1.5 ? 4.0 : 7.0;
    float yy = (vUv.y / 0.78) * rows + (kind < 0.5 ? uTime * 0.9 : 0.0);
    float rr = floor(yy), fy = fract(yy);
    float len = 0.25 + 0.6 * h1(rr + floor(vA.x * 3.0 + 0.5)); // 투명도 1.0 이 보간 오차로 0.99999 가 되면 줄 길이가 화소마다 튀지 않게 반올림
    lines = step(0.06, vUv.x) * step(vUv.x, 0.06 + len * 0.88) * step(0.3, fy) * step(fy, 0.7) * step(vUv.y, 0.76);
  }
  vec3 col; float a;
  if (uLight < 0.5) {
    col = c * (0.3 + 0.06 * scan) + c * edge * 1.0 + c * head * 0.6 + c * lines * 0.6;
    a = (0.5 + 0.45 * edge + 0.3 * head + 0.3 * lines) * vA.x;
  } else {
    vec3 paper = vec3(0.96, 0.975, 1.0);
    col = mix(paper, c, 0.16 + 0.03 * scan);
    col = mix(col, c * 0.72, edge * 0.95 + head * 0.8 + lines * 0.5);
    a = (0.72 + 0.25 * edge + 0.05 * head) * vA.x;
  }
  gl_FragColor = vec4(col, a);
}`;

export class VxHolo {
  constructor(view) {
    this.view = view;
    const scene = view.scene;
    this.book = new HoloBook({ max: 256, perNode: 4, stack: 2 });
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aFlash = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('iColor', this.aColor); geo.setAttribute('iFlash', this.aFlash); geo.setAttribute('iA', this.aA);
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    // 손끝 빛줄기
    this.tPos = new Float32Array(THREAD_CAP * 6); this.tCol = new Float32Array(THREAD_CAP * 6);
    this.tGeo = new THREE.BufferGeometry();
    this.tGeo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tGeo.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
    this.threads = new THREE.LineSegments(this.tGeo, this.tMat);
    this.threads.frustumCulled = false; this.threads.renderOrder = 4;
    scene.add(this.mesh, this.threads);
    this.text = new HoloText(scene);
    this._tc = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
    this._catC = new Map(); this._ink = new Map();
    this._fa = 1; // 지금 그리는 자리의 프로젝트 페이드(_put·_thread 가 곱함)
    this._dash = new Map(); // 기동기 id → 대시보드 패널 항목(같은 객체 유지 → 글 칸 재사용)
    this.stats = { frames: 0, text: 0, monitors: 0, pops: 0, threads: 0 };
    this.applyTheme(view.tokens);
  }

  applyTheme(t) {
    this.tokens = t;
    this.uniforms.uLight.value = t.isLight ? 1 : 0;
    this.text.setLight(!!t.isLight);
    this.mat.blending = THREE.NormalBlending;
    this.tMat.blending = t.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.tMat.needsUpdate = true; this.mat.needsUpdate = true;
    this._catC.clear(); this._ink.clear();
  }
  _cat(cat) {
    if (cat === 'skill') return this.tokens.skill;
    if (cat === 'say') return this.tokens.text;
    let c = this._catC.get(cat);
    if (!c) { c = new THREE.Color(catColor(cat, this.tokens.isLight)); this._catC.set(cat, c); }
    return c;
  }
  _inkOf(cat) {
    let s = this._ink.get(cat);
    if (!s) {
      const c = this._c.copy(this._cat(cat));
      if (this.tokens.isLight) c.multiplyScalar(0.55); else c.lerp(new THREE.Color(1, 1, 1), 0.5);
      s = '#' + c.getHexString(); this._ink.set(cat, s);
    }
    return s;
  }
  _res(res) { const t = this.tokens; return res === 'error' ? t.error : res === 'stopped' ? t.stopped : t.ok; }

  // ---- 장부(app.onEvent → view → 여기) ----
  start(nodeId, ev, { quiet = false, speed = 1 } = {}) {
    const now = performance.now() / 1000;
    const e = this.book.start(nodeId, ev, now, { quiet, minShow: HOLO.MIN_SHOW / Math.min(4, Math.max(1, Math.sqrt(speed || 1))) });
    if (!quiet) { // 도구 호출 순간 튀어나왔다 들어가는 작은 창
      const ch = this.view.chars.get(nodeId);
      if (ch) { const p = ch._pops || (ch._pops = []); p.push({ t0: now, cat: ev.skill ? 'skill' : ev.cat || 'other', i: (ch._popN = (ch._popN || 0) + 1) }); if (p.length > MON.POP_MAX) p.shift(); }
    }
    return e;
  }
  end(nodeId, toolUseId, res, result = '') { return this.book.end(nodeId, toolUseId, res, performance.now() / 1000, result); }
  endAll(nodeId, res) { this.book.endAll(nodeId, res, performance.now() / 1000); }
  foldNode(nodeId) { this.book.foldNode(nodeId, performance.now() / 1000); }
  removeNode(nodeId) { this.book.removeNode(nodeId); this._dash.delete(nodeId); }
  /** app.onEvent: 패널 내용(panel·parentPanel) — 라이브·재생·mock 공통 */
  event(ev, { quiet = false } = {}) { return this.book.panelEvent(ev, performance.now() / 1000, { quiet }); }
  clear() { this.book.clear(); this._dash.clear(); this.mesh.count = 0; this.text.clear(); this.threads.visible = false; }
  /** 노드 모니터가 떠 있나(라벨·말풍선 자리) */
  monTop(ch) { return ch && ch._monK > 0.05 ? ch._monTop || 0 : 0; }

  _put(n, x, y, z, W, H, col, flashC, alpha, flash, kind, hasText) {
    this._p.set(x, y, z); this._s.set(Math.max(1e-3, W), Math.max(1e-3, H), 1);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(n, this._m);
    const C = this.aColor.array, F = this.aFlash.array, A = this.aA.array;
    C[n * 3] = col.r; C[n * 3 + 1] = col.g; C[n * 3 + 2] = col.b;
    F[n * 3] = flashC.r; F[n * 3 + 1] = flashC.g; F[n * 3 + 2] = flashC.b;
    A[n * 4] = alpha * this._fa; A[n * 4 + 1] = flash; // _fa = 그 자리 동의 프로젝트 페이드 A[n * 4 + 2] = kind; A[n * 4 + 3] = hasText ? 1 : 0;
  }
  _thread(nt, a, bx, by, bz, col, k) {
    if (nt >= THREAD_CAP) return nt;
    k *= this._fa;
    const q = nt * 6, bg = this.tokens.bg;
    this.tPos[q] = a.x; this.tPos[q + 1] = a.y; this.tPos[q + 2] = a.z; this.tPos[q + 3] = bx; this.tPos[q + 4] = by; this.tPos[q + 5] = bz;
    const c = this._c2.copy(col).lerp(bg, 1 - k);
    this.tCol[q] = c.r; this.tCol[q + 1] = c.g; this.tCol[q + 2] = c.b;
    c.copy(col).lerp(bg, 1 - k * 0.6);
    this.tCol[q + 3] = c.r; this.tCol[q + 4] = c.g; this.tCol[q + 5] = c.b;
    return nt + 1;
  }
  _cand(i) { return this._tc[i] || (this._tc[i] = { e: null, x: 0, y: 0, z: 0, W: 0, H: 0, px: 0, alpha: 0, swap: 0, score: 0, ink: '', slot: null }); }

  /** 매 프레임 */
  update(now, dt, camera, viewportH) {
    const v = this.view, book = this.book;
    book.step(now, (id) => { const n = v.nodes.get(id); return !!n && n.status === 'active'; });
    this.uniforms.uTime.value = now % 1000;
    const cp = camera.position, fov = camera.fov;
    let n = 0, nt = 0, ntc = 0, mons = 0, pops = 0;
    const focus = v.focusId, hover = v.hoverId;
    const far = !!v._farAll;
    const top = this._topActive(now);
    for (const ch of v.chars.values()) {
      if (ch.state === 'gone' || !ch.placed || ch.offstage || !ch.seat || v._isDim(ch.id)) { ch._monK = 0; continue; }
      this._fa = v._fxA ? v._fxA(ch.seat.deskX, ch.seat.deskZ) : 1; // 프로젝트 페이드(문턱 대신 투명도)
      const arr = book.list(ch.id);
      let main = null, mt = -Infinity, has = false;
      for (const e of arr) {
        if (e.slot < 0) continue;
        const ph = book.phaseOf(e, now);
        if (ph.phase === 'gone') continue;
        has = true;
        const t = Math.max(e.t0, e.swapAt ?? -Infinity) + (e.endAt == null ? 1e3 : 0);
        if (t > mt) { mt = t; main = e; }
      }
      const atDesk = ch.atDesk() && ch.seat.kind !== 'meet';
      ch._monK = stepOpen(ch._monK || 0, monitorWanted(has, atDesk), dt);
      const pp = ch._pops;
      if (pp) while (pp.length && now - pp[0].t0 > MON.POP) pp.shift();
      if (ch._monK <= 0.001 || n >= CAP - 8) { ch._monTop = 0; continue; }
      const s = ch.seat, lead = s.kind === 'lead', fc = ch.id === focus || ch.id === hover;
      const face = s.face || 0, fx = Math.sin(face), fz = Math.cos(face);
      let H = MON.H * (lead ? MON.LEAD_K : 1) * (fc ? 1.3 : 1);
      const mx = s.deskX + fx * 0.12, mz = s.deskZ + fz * 0.12;
      const dist = Math.hypot(mx - cp.x, DESK_TOP + 0.7 - cp.y, mz - cp.z);
      let px = panelPx(H, dist, fov, viewportH);
      // 최근 활동 상위·포커스 노드는 멀어도 제목이 읽히게 조금 키움(최대 BOOST 배, Flow 의 최소 크기 규칙과 같은 뜻)
      if ((fc || top.has(ch.id)) && px > 0 && px < MON.MIN_PX && !far) { const k = Math.min(MON.BOOST, MON.MIN_PX / px); H *= k; px *= k; }
      const W = H * MON.ASP;
      const { sx, sy } = openShape(ch._monK);
      const my = DESK_TOP + 0.16 + (H * sy) / 2;
      ch._monTop = DESK_TOP + 0.16 + H * sy;
      ch._monFit = { x: mx, z: mz, hw: (W * sx) / 2, px: fz, pz: -fx, top: ch._monTop, t: now }; // 전체 맞춤이 담는 모니터 자리(가로 = 얼굴 방향에 수직)
      if (px < 3) continue;
      const ph = main ? book.phaseOf(main, now) : null;
      const cat = main ? main.cat : 'other';
      ch._monCat = main ? cat : null;
      const col = this._cat(cat), fl = this._res(main ? main.res : 'ok');
      // 글(가까우면): 장부 항목을 그대로 넘기되 모양은 모니터(터미널 창, 같은 가로세로비)
      let hasText = false;
      if (main && ch._monK > 0.85 && px >= PANEL.TITLE_PX * 0.9 && !far) {
        const pe = ch._monE || (ch._monE = { id: '', panel: null, pv: 0, shape: 0, asp: MON.ASP, label: { tool: '', target: '' }, res: 'ok', result: '', cat: 'other', tool: '', scrollAt: null, scrollN: 0 });
        if (pe.id !== main.id || pe.pv !== main.pv || pe.res !== main.res || pe.result !== main.result) {
          pe.id = main.id; pe.panel = main.panel; pe.pv = main.pv; pe.label = main.label; pe.res = main.res; pe.result = main.result; pe.cat = main.cat; pe.tool = main.tool;
        }
        pe.scrollAt = main.scrollAt; pe.scrollN = main.scrollN;
        const c0 = this._cand(ntc++);
        c0.e = pe; c0.x = mx; c0.y = my; c0.z = mz; c0.W = W * sx; c0.H = H * sy; c0.px = px; c0.alpha = Math.min(1, (ch._monK - 0.85) / 0.15) * (ph ? ph.alpha : 1) * this._fa;
        c0.swap = 0; c0.score = (fc ? 1e6 : 0) + px + (main.endAt == null ? 50 : 0) + (lead ? 30 : 0); c0.ink = this._inkOf(cat);
        c0.inst = n;
        hasText = true;
      }
      this._put(n++, mx, my, mz, W * sx, H * sy, col, fl, (ph ? Math.max(0.5, ph.alpha) : 0.8) * Math.min(1, ch._monK * 1.5), ph ? ph.flash : 0, 0, hasText);
      mons++;
      // 동시에 열린 다른 도구 = 모니터 옆 작은 창
      let mi = 0;
      for (const e of arr) {
        if (e === main || e.slot < 0 || mi >= MON.MINI_MAX || n >= CAP) continue;
        const p2 = book.phaseOf(e, now);
        if (p2.phase === 'gone') continue;
        const side = mi === 0 ? 1 : mi === 1 ? -1 : 0;
        const ox = side * (W / 2 + 0.34), oy = side ? H * 0.28 : H / 2 + 0.3;
        this._put(n++, mx + ox * fz, my + oy, mz - ox * fx, 0.56 * p2.sx, 0.36 * p2.sy, this._cat(e.cat), this._res(e.res), p2.alpha * 0.95, p2.flash, 1, false);
        mi++;
      }
      // 도구 호출 순간 튀어나왔다 들어가는 작은 창
      if (pp) for (const p of pp) {
        if (n >= CAP) break;
        const ps = popShape((now - p.t0) / MON.POP);
        if (!ps) continue;
        const lx = ((p.i % 3) - 1) * 0.42;
        this._put(n++, mx + lx * fz, my + H * sy * 0.5 + 0.12 + ps.up * 0.55, mz - lx * fx, 0.42 * ps.s, 0.27 * ps.s, this._cat(p.cat), this._cat(p.cat), ps.alpha, 0, 1, false);
        pops++;
      }
      // 손끝 빛줄기(두드리는 중)
      if (ch.state === 'work' && atDesk && ch._monK > 0.6 && ch._hand && px > 8) {
        const by = my - (H * sy) / 2, k = 0.55 + 0.35 * Math.sin(now * 9 + ch.phase);
        for (let i = 0; i < 2; i++) { const o = (i ? 1 : -1) * W * 0.18; nt = this._thread(nt, ch._hand[i], mx + o * fz, by, mz - o * fx, col, k); }
      }
    }
    // 기동기 대시보드(복합기 위)
    for (const m of v.machines.values()) {
      if (m.type !== 'batch' || m.released || !m.pos || v._isDim(m.id) || n >= CAP) continue;
      this._fa = v._fxA ? v._fxA(m.pos.x, m.pos.z) : 1;
      const H = 0.95, W = 1.6;
      const x = m.pos.x + 0.1, z = m.pos.z, y = 1.6 + H / 2 + 0.12;
      const dist = Math.hypot(x - cp.x, y - cp.y, z - cp.z);
      const px = panelPx(H, dist, fov, viewportH);
      if (px < 3) continue;
      if (!m.info) m.info = deviceInfo(m.node, v.nodes);
      const info = m.info, run = info.running > 0 && m.node.status !== 'done' && m.node.status !== 'stopped';
      const col = run ? this.tokens.skill : this.tokens.stopped;
      let hasText = false;
      if (px >= PANEL.TITLE_PX * 0.9 && !far) {
        const de = this._dashOf(m, info);
        const c0 = this._cand(ntc++);
        c0.e = de; c0.x = x; c0.y = y; c0.z = z; c0.W = W; c0.H = H; c0.px = px; c0.alpha = this._fa; c0.swap = 0;
        c0.score = (m.id === focus ? 1e6 : 0) + 2e5 + px; c0.ink = this._inkOf('skill'); c0.inst = n;
        hasText = true;
      }
      this._put(n++, x, y, z, W, H, col, col, run ? 0.95 : 0.6, 0, 2, hasText);
    }
    this._fa = 1;
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.aColor.needsUpdate = true; this.aFlash.needsUpdate = true; this.aA.needsUpdate = true; }
    const tf = this.text.update(this._tc, ntc, now);
    let tn = 0;
    for (let i = 0; i < ntc; i++) { const c0 = this._tc[i]; if (c0.e._txf !== tf) this.aA.array[c0.inst * 4 + 3] = 0; else tn++; }
    this.tGeo.setDrawRange(0, nt * 2);
    if (nt) { this.tGeo.attributes.position.needsUpdate = true; this.tGeo.attributes.color.needsUpdate = true; }
    this.threads.visible = nt > 0;
    const s = this.stats; s.frames = n; s.text = tn; s.monitors = mons; s.pops = pops; s.threads = nt;
  }

  /** 최근 도구 활동 상위 노드(0.25초마다) */
  _topActive(now) {
    if (this._topAt && now - this._topAt < 0.25) return this._top;
    this._topAt = now;
    const L = [];
    for (const [nid, arr] of this.book.byNode) { let t = -Infinity; for (const e of arr) if (e.slot >= 0) t = Math.max(t, e.t0, e.swapAt ?? -Infinity); if (t > -Infinity) L.push([t, nid]); }
    L.sort((a, b) => b[0] - a[0]);
    this._top = new Set(L.slice(0, MON.TOP).map((x) => x[1]));
    return this._top;
  }

  /** 기동기 대시보드 패널 항목(내용이 바뀔 때만 pv 증가) */
  _dashOf(m, info) {
    let e = this._dash.get(m.id);
    if (!e) { e = { id: 'dash:' + m.id, panel: null, pv: 0, shape: 0, asp: 1.6 / 0.95, label: { tool: _t('scene.dash.launcher'), target: '' }, res: 'ok', result: '', cat: 'skill', tool: _t('scene.dash.launcher'), _key: '' }; this._dash.set(m.id, e); }
    const cur = info.currentId ? this.view.nodes.get(info.currentId) : null;
    const pr = cur ? cycleProgress(info, cur, this.view.clock()) : null;
    const bar = pr == null ? '' : '▮'.repeat(Math.round(pr * 10)) + '▯'.repeat(10 - Math.round(pr * 10)) + ` ${Math.round(pr * 100)}%`;
    const lines = [_t('scene.dash.runs', { n: info.total }) + (info.running ? _t('scene.dash.running', { n: info.running }) : ''), _t('scene.dash.done', { n: info.done }) + (info.failed ? _t('scene.dash.failed', { n: info.failed }) : '') + (info.stopped ? _t('scene.dash.stopped', { n: info.stopped }) : '')];
    const avg = fmtDur(info.avgMs);
    if (avg) lines.push(_t('scene.dash.avg', { t: avg }));
    if (bar) lines.push(bar);
    const marks = 'o' + (info.failed ? 'e' : '+') + (avg ? 'd' : '') + (bar ? 'h' : '');
    const title = (m.node.label || _t('scene.dash.launcher')).slice(0, 40);
    const key = title + '|' + lines.join('|');
    if (key !== e._key) {
      e._key = key; e.pv++;
      e.panel = { mode: 'generic', part: '', title, lines, marks, more: 0, hidden: '', thin: false, ref: null };
    }
    return e;
  }

  dispose() {
    this.clear();
    this.mesh.removeFromParent(); this.threads.removeFromParent();
    this.mesh.geometry.dispose(); this.tGeo.dispose(); this.mat.dispose(); this.tMat.dispose();
    this.text.dispose();
  }
}
