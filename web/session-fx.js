// 같은 프로젝트 여러 live 세션의 3D 연출 — Planet·Flow 공용(SceneView 가 만든다).
//  · 같은 파일 충돌: 두 메인 사이 주황 곡선(점 사슬 + 가는 선, 강 = 굵게) + 그 위를 왕복하는 파일명 칩. 사라지면 30초 동안 흐려짐
//  · 세션 간 메시지: 메인 ↔ 메인 패킷(빛 구) + 도착 메인 물결
// 상태(ConflictBook)는 app 이 들고 있고, 여기서는 매 프레임 읽어 그리기만 한다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { escapeHtml } from './html-util.mjs';
import { arcControl } from './session-core.mjs';
import { conflictPairs, pairChipText } from './conflict-core.mjs';
import { t as tr } from './i18n.mjs';
import { fxShown, fxAlpha } from './proj-fade.mjs';

const CAP = 48;          // 그릴 충돌 상한
const DOTS = 20;         // 곡선 하나의 점 수
const SEG = 24;          // 곡선 선 토막 수

export class SessionFx {
  constructor(scene, view) {
    this.view = view;
    this.book = null;
    this.group = new THREE.Group();
    this.group.name = 'session-fx';
    scene.add(this.group);
    const g = new THREE.SphereGeometry(1, 8, 6);
    this.dotMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.95 });
    this.dots = new THREE.InstancedMesh(g, this.dotMat, CAP * DOTS);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 3;
    this.dots.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.dots);
    this.linePos = new Float32Array(CAP * SEG * 2 * 3);
    this.lineCol = new Float32Array(CAP * SEG * 2 * 3);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineGeo.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineGeo.setDrawRange(0, 0);
    this.lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
    this.lines = new THREE.LineSegments(this.lineGeo, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.group.add(this.lines);
    this.chips = new Map(); // conflict id → {obj, el, html}
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color(); this._cc = new THREE.Color();
    this.count = 0;
  }

  setBook(book) { this.book = book; }

  /** 화면에 그릴 수 있는 메인(보이고, 고정 희미 아님). 페이드 중이면 그대로 두고 투명도(fxAlpha)를 곱한다 */
  _vis(id) {
    const v = this.view.vis.get(id);
    return fxShown(v) ? v : null;
  }

  update(now) {
    const view = this.view, t = view.tokens;
    const items = this.book ? conflictPairs(this.book.items(Date.now())) : []; // 같은 두 메인 사이는 곡선 하나(파일 여럿이면 '외 n')
    const base = t.conflict || this._cc.set('#ff9a3c');
    const bg = t.bg;
    const camDist = view.focusDist || view.camera.position.length();
    const ws = Math.max(1, camDist / 38);
    let nd = 0, nl = 0, n = 0;
    const seen = new Set();
    const pairN = new Map();
    for (const it of items) {
      if (n >= CAP) break;
      const A = this._vis(it.a), B = this._vis(it.b);
      if (!A || !B || A === B) continue;
      const pk = it.a < it.b ? it.a + '|' + it.b : it.b + '|' + it.a;
      const slot = pairN.get(pk) || 0; pairN.set(pk, slot + 1);
      const a = A.group.position, b = B.group.position;
      const cp = arcControl(a, b, slot, view.labelBelow ? 'flat' : 'up');
      const k = Math.max(0, Math.min(1, it.k));
      const fa = fxAlpha(A, B); // 프로젝트 페이드
      const strong = it.level === 'strong';
      const col = this._c.copy(base).lerp(bg, (1 - k) * 0.85 + (strong ? 0 : 0.15));
      if (fa < 1) col.lerp(bg, 1 - fa);
      // Planet 관계선 표현이 충돌을 직접 그리면(레이저 간섭·궤도 겹침) 곡선·점 사슬은 건너뛰고 칩 자리만 받는다
      const own = view.confHook ? view.confHook(A, B, k * fa, strong, slot, this._cp || (this._cp = new THREE.Vector3())) : false;
      if (!own) {
      // 가는 선
      for (let i = 0; i < SEG; i++) {
        const u0 = i / SEG, u1 = (i + 1) / SEG, q = (nl * SEG + i) * 6;
        bez(this._p, a, cp, b, u0); this.linePos[q] = this._p.x; this.linePos[q + 1] = this._p.y; this.linePos[q + 2] = this._p.z;
        bez(this._p, a, cp, b, u1); this.linePos[q + 3] = this._p.x; this.linePos[q + 4] = this._p.y; this.linePos[q + 5] = this._p.z;
        for (let j = 0; j < 6; j += 3) { this.lineCol[q + j] = col.r; this.lineCol[q + j + 1] = col.g; this.lineCol[q + j + 2] = col.b; }
      }
      nl++;
      // 점 사슬(흐르듯 움직임): 강 = 굵고 촘촘, 약 = 가늘고 성기게
      const nDots = strong ? DOTS : Math.round(DOTS * 0.6);
      const rad = (strong ? 0.34 : 0.17) * ws * (0.6 + 0.4 * k);
      const ph = (now * (strong ? 0.35 : 0.22)) % 1;
      for (let i = 0; i < nDots; i++) {
        const u = ((i + ph) / nDots) % 1;
        if (u < 0.06 || u > 0.94) continue; // 메인 칩 안쪽은 비움
        bez(this._p, a, cp, b, u);
        this._s.setScalar(rad);
        this._m.compose(this._p, this._q, this._s);
        this.dots.setMatrixAt(nd, this._m);
        this.dots.setColorAt(nd, col);
        nd++;
      }
      }
      // 파일명 칩: 곡선 위를 왕복
      seen.add(it.id);
      let ch = this.chips.get(it.id);
      if (!ch) {
        const el = document.createElement('div');
        el.className = 'cf-chip';
        const obj = new CSS2DObject(el);
        obj.center.set(0.5, 0.5);
        this.group.add(obj);
        ch = { obj, el, html: '', seed: (this.chips.size * 1.37) % 6.28 };
        this.chips.set(it.id, ch);
      }
      const html = `<b>${escapeHtml(pairChipText(it))}</b>`;
      if (ch.html !== html) { ch.el.innerHTML = html; ch.html = html; ch.el.title = tr('cards.sess.same', { how: tr(strong ? 'cards.sess.both' : 'cards.sess.one'), paths: it.paths.join(', ') }); }
      ch.el.classList.toggle('strong', strong);
      ch.el.classList.toggle('fading', !!it.fading);
      if (own) ch.obj.position.copy(this._cp);
      else { const u = 0.5 + 0.36 * Math.sin(now * 0.8 + ch.seed); bez(this._p, a, cp, b, u); ch.obj.position.copy(this._p); }
      const op = (Math.round(k * fa * 20) / 20).toFixed(2);
      if (ch.el.style.opacity !== op) ch.el.style.opacity = op;
      n++;
    }
    for (const [id, ch] of this.chips) if (!seen.has(id)) { ch.obj.removeFromParent(); ch.el.remove(); this.chips.delete(id); }
    this._declutter();
    this.dots.count = nd;
    if (nd) { this.dots.instanceMatrix.needsUpdate = true; if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true; }
    this.lineGeo.setDrawRange(0, nl * SEG * 2);
    if (nl) { this.lineGeo.attributes.position.needsUpdate = true; this.lineGeo.attributes.color.needsUpdate = true; }
    const blend = t.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (this.dotMat.blending !== blend) { this.dotMat.blending = blend; this.dotMat.needsUpdate = true; }
    this.count = n;
  }

  /** 칩끼리 화면에서 겹치면 뒤 칩을 아래로 비킨다(CSS translate, 0.25초마다) */
  _declutter() {
    const v = this.view, now = performance.now();
    if (now - (this._dcAt || 0) < 250 || !this.chips.size) return;
    this._dcAt = now;
    const W = v.container.clientWidth || 1, H = v.container.clientHeight || 1, p = this._p;
    const boxes = [];
    for (const ch of this.chips.values()) {
      p.copy(ch.obj.position).project(v.camera);
      const x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H, w = (ch.el.offsetWidth || 70) / 2 + 2, h = (ch.el.offsetHeight || 18) + 2;
      let dy = 0;
      for (let guard = 0; guard < 8 && boxes.some((b) => Math.abs(b.x - x) < b.w + w && Math.abs(b.y - (y + dy)) < h); guard++) dy += h;
      boxes.push({ x, y: y + dy, w });
      const tr = dy ? `0 ${dy}px` : '';
      if ((ch._tr || '') !== tr) { ch._tr = tr; ch.el.style.translate = tr; }
    }
  }

  /** 세션 간 메시지: 보내는 메인 → 받는 메인 빛 구 + 도착 물결 */
  message(ev) {
    const v = this.view;
    const from = this._vis(ev.nodeId) ? ev.nodeId : null, to = this._vis(ev.peer) ? ev.peer : null;
    if (!from || !to) return false;
    const fv = v.vis.get(from);
    const col = fv && fv.sessC ? fv.sessC : v.tokens['flow-call'];
    v.orb(from, to, col, 1.5);
    setTimeout(() => { if (v.vis.has(to)) v.ripple(to, col); }, 1400);
    return true;
  }

  /** 라벨이 피할 칩 상자(장애물) */
  chipRects(camera, W, H, out = []) {
    const p = this._p;
    for (const ch of this.chips.values()) {
      if (!ch.el.isConnected) continue;
      p.copy(ch.obj.position).project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H, w = (ch.el.offsetWidth || 60) / 2, h = (ch.el.offsetHeight || 18) / 2;
      out.push([x - w, y - h, x + w, y + h]);
    }
    return out;
  }

  dispose() {
    for (const ch of this.chips.values()) { ch.obj.removeFromParent(); ch.el.remove(); }
    this.chips.clear();
    this.group.removeFromParent();
    this.dots.geometry.dispose(); this.dotMat.dispose(); this.lineGeo.dispose(); this.lineMat.dispose();
  }
}

/** 이차 베지에 a → c → b 의 u 지점 */
function bez(out, a, c, b, u) {
  const v = 1 - u;
  out.set(v * v * a.x + 2 * v * u * c.x + u * u * b.x, v * v * a.y + 2 * v * u * c.y + u * u * b.y, v * v * a.z + 2 * v * u * c.z + u * u * b.z);
  return out;
}
