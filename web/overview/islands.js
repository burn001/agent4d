// 도형 모드 전체 보기: 프로젝트 클러스터 섬(바닥판·가장자리 고리·이름표)
// SceneView 가 scope=all 일 때만 만든다. 이름표는 CSS2D(장면에 붙임 → SceneView 의 labelRenderer 가 그림).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { pickIslandAt, islandStyle, PULSE_AMP, islandOutline, zoneRayLen } from './pick-core.mjs';
export { pickIslandAt, pickRectAt, pickLabelAt, islandPickTol, islandStyle } from './pick-core.mjs';

/** 슈퍼타원 섬 도형(경계 상자에 내접): 채움·가장자리 고리(얇게, 두께 w)·안쪽 고리(0.62) — 상자 크기가 바뀔 때만 다시 만든다 */
function shapeOf(pts) { const sh = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z))); sh.closePath(); return sh; }
function islandGeos(box) {
  const outer = islandOutline(box, 1);
  const w = Math.max(0.18, Math.max(box.hw, box.hd) * 0.012);
  const innerK = (k) => islandOutline({ hw: Math.max(0.5, box.hw * k - 0), hd: Math.max(0.5, box.hd * k) }, 1);
  const ringSh = shapeOf(outer);
  ringSh.holes.push(new THREE.Path(islandOutline({ hw: Math.max(0.4, box.hw - w), hd: Math.max(0.4, box.hd - w) }, 1).map(([x, z]) => new THREE.Vector2(x, -z))));
  const inSh = shapeOf(innerK(0.62));
  inSh.holes.push(new THREE.Path(islandOutline({ hw: Math.max(0.4, box.hw * 0.62 - 0.12), hd: Math.max(0.4, box.hd * 0.62 - 0.12) }, 1).map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = { disc: new THREE.ShapeGeometry(shapeOf(outer)), ring: new THREE.ShapeGeometry(ringSh), inner: new THREE.ShapeGeometry(inSh) };
  for (const x of Object.values(g)) x.rotateX(-Math.PI / 2);
  return g;
}

export const ISLAND_Y = -2.5;

let GEO = null;
function geo() {
  if (GEO) return GEO;
  GEO = { disc: new THREE.CircleGeometry(1, 72), ring: new THREE.RingGeometry(0.965, 1, 96), inner: new THREE.RingGeometry(0.62, 0.625, 72) };
  for (const g of Object.values(GEO)) g.rotateX(-Math.PI / 2);
  return GEO;
}

// 이름표 문구·CSS 불러오기는 순수 모듈(island-label.mjs)로 옮겼다 — 2D 표현이 three 없이 같은 이름표를 쓴다
import { ensureOverviewCss, islandLabelHtml } from './island-label.mjs';
export { ensureOverviewCss, islandLabelHtml };

export class Islands {
  constructor(scene, tokens) {
    ensureOverviewCss();
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'overview-islands';
    scene.add(this.group);
    this.items = new Map();   // projectId → {disc, ring, inner, label, el, c}
    this.tokens = tokens;
    this.focus = null;
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ISLAND_Y);
    this._hit = new THREE.Vector3();
  }

  /** clusters: computeOverview 결과 */
  sync(clusters) {
    const keep = new Set();
    const G = geo();
    for (const c of clusters) {
      keep.add(c.projectId);
      let it = this.items.get(c.projectId);
      if (!it) {
        const dm = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const rm = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const im = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const disc = new THREE.Mesh(G.disc, dm), ring = new THREE.Mesh(G.ring, rm), inner = new THREE.Mesh(G.inner, im);
        disc.renderOrder = -2; ring.renderOrder = -1; inner.renderOrder = -1;
        const el = document.createElement('div');
        el.className = 'ov-island';
        const label = new CSS2DObject(el);
        label.center.set(0.5, 0);
        const g = new THREE.Group();
        g.add(disc, ring, inner, label);
        this.group.add(g);
        it = { g, disc, ring, inner, label, el, c, html: '', seed: (this.items.size * 1.7) % 6 };
        this.items.set(c.projectId, it);
      }
      const born = !it.c || it.c === c;
      it.c = c;
      it.el.dataset.pid = c.projectId;
      // 다시 배치되면 섬 바닥도 노드 스프링과 비슷하게 미끄러져 옮겨 감(새 섬은 바로 그 자리)
      it.tx = c.center.x; it.tz = c.center.z;
      if (born || !it.placed) { it.g.position.set(c.center.x, ISLAND_Y, c.center.z); it.placed = true; }
      if (c.box) {
        // 둥근 사각형: 상자 크기가 바뀔 때만 도형을 다시 만든다(배율 1)
        const key = c.box.hw.toFixed(1) + ',' + c.box.hd.toFixed(1);
        if (it.boxKey !== key) {
          it.boxKey = key;
          const g = islandGeos(c.box);
          for (const k of ['disc', 'ring', 'inner']) { if (it.own && it[k].geometry) it[k].geometry.dispose(); it[k].geometry = g[k]; it[k].scale.setScalar(1); }
          it.own = true;
        }
      } else {
        for (const m of [it.disc, it.ring]) m.scale.setScalar(c.r);
        it.inner.scale.setScalar(c.r);
      }
      it.inner.visible = !c.inactive && Math.max(c.box ? c.box.hw : c.r, c.box ? c.box.hd : c.r) > 14 && !c.orbit && !c.zones;
      it.label.position.set(0, 0.2, (c.box ? c.box.hd : c.r) + 1.2);
      this._syncDeco(it, c);
      const html = islandLabelHtml(c);
      if (html !== it.html) { it.el.innerHTML = html; it.html = html; }
      it.el.classList.toggle('inactive', !!c.inactive);
      this._style(it);
    }
    for (const [pid, it] of this.items) if (!keep.has(pid)) this._drop(pid, it);
  }

  /** 같은 섬 live 메인 여럿: 마주 보기 = 옅은 공전 고리, 파이 = 구역 경계 옅은 선 */
  _syncDeco(it, c) {
    const key = c.orbit ? 'o' + c.orbit.r.toFixed(1) + ':' + (c.orbit.cx || 0).toFixed(1) + ',' + (c.orbit.cz || 0).toFixed(1) : c.zones ? 'z' + c.zones.n + ':' + c.zones.r0.toFixed(1) + ':' + c.box.hw.toFixed(1) + ',' + c.box.hd.toFixed(1) + ':' + c.zones.dirs.map((d) => d.toFixed(2)).join(',') : '';
    if (it.decoKey === key) return;
    it.decoKey = key;
    if (it.deco) { it.g.remove(it.deco); it.deco.geometry.dispose(); it.deco.material.dispose(); it.deco = null; }
    if (!key) return;
    const t = this.tokens;
    if (c.orbit) {
      const g = new THREE.RingGeometry(c.orbit.r - 0.12, c.orbit.r + 0.12, 96);
      g.rotateX(-Math.PI / 2);
      it.deco = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, color: t.link, opacity: t.isLight ? 0.32 : 0.26 }));
      it.deco.position.set(c.orbit.cx || 0, 0.05, c.orbit.cz || 0);
    } else {
      const pts = [];
      const zx = c.zones.cx || 0, zz = c.zones.cz || 0;
      for (const a of c.zones.dirs) {
        const ux = Math.cos(a), uz = Math.sin(a);
        const L = zoneRayLen(c.box, zx, zz, a); // 섬 상자 가장자리까지(조금 안쪽)
        pts.push(new THREE.Vector3(zx + ux * c.zones.r0, 0.05, zz + uz * c.zones.r0), new THREE.Vector3(zx + ux * L, 0.05, zz + uz * L));
      }
      it.deco = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, color: t.link, opacity: t.isLight ? 0.4 : 0.32 }));
    }
    it.deco.renderOrder = -1;
    it.g.add(it.deco);
  }

  setFocus(pid) { this.focus = pid || null; this.restyle(); }
  /** 프로젝트 페이드가 움직일 때마다 다시 칠함 */
  restyle() { for (const it of this.items.values()) this._style(it); }

  _style(it) {
    const t = this.tokens, c = it.c;
    // 다른 프로젝트 섬은 흐리게 두지 않고 페이드 아웃 → 숨김(pf = SceneView 의 ProjFade)
    const fa = this.pf ? this.pf.alpha(c.projectId) : 1;
    const gone = !!(this.pf && this.pf.gone(c.projectId));
    if (it.g.visible === gone) it.g.visible = !gone;
    const st = islandStyle({ inactive: !!c.inactive, hot: !!(c.active || c.busy), dimmed: false, light: !!t.isLight });
    for (const k of ['disc', 'ring', 'inner']) st[k] *= fa;
    it.disc.material.color.copy(t.grid);
    it.disc.material.opacity = st.disc;
    // 고리는 늘 링크색을 배경 쪽으로 섞은 옅은 선(바쁜 섬도 강조색·맥동 없음 — 인식만 되게)
    it.ring.material.color.copy(t.link);
    if (t.bg) it.ring.material.color.lerp(t.bg, st.ringMix);
    it.baseRing = st.ring;
    it.ring.material.opacity = it.baseRing;
    it.inner.material.color.copy(t.link);
    it.inner.material.opacity = st.inner;
    if (it.deco) { it.deco.material.color.copy(t.link); it.deco.material.opacity = (t.isLight ? 0.14 : 0.11) * fa; }
    const op = fa < 1 ? (Math.round(fa * 20) / 20).toFixed(2) : '';
    if (it.el.style.opacity !== op) it.el.style.opacity = op;
    it.el.classList.toggle('dim', false);
    it.el.classList.toggle('focus', this.focus === c.projectId);
  }

  applyTheme(tokens) { this.tokens = tokens; for (const it of this.items.values()) this._style(it); }

  /** busy 클러스터 고리가 천천히 빛남 */
  update(now) {
    const dt = Math.min(0.1, Math.max(0, now - (this._lastNow ?? now)));
    this._lastNow = now;
    const k = 1 - Math.exp(-dt * 7); // 약 0.6초에 거의 도착
    for (const it of this.items.values()) {
      const p = it.g.position;
      if (it.tx != null && (Math.abs(it.tx - p.x) > 1e-3 || Math.abs(it.tz - p.z) > 1e-3)) { p.x += (it.tx - p.x) * k; p.z += (it.tz - p.z) * k; }
    }
    for (const it of this.items.values()) {
      if (!it.c.busy) { if (it.ring.material.opacity !== it.baseRing) it.ring.material.opacity = it.baseRing; continue; }
      const k = 0.5 + 0.5 * Math.sin(now * 1.6 + it.seed);
      it.ring.material.opacity = it.baseRing * (1 - PULSE_AMP + PULSE_AMP * k); // PULSE_AMP = 0(맥동 없음)
    }
  }

  /** 섬 이름표의 화면 사각형(px) — 노드 라벨이 피한다. 크기는 글이 바뀔 때만 잰다 */
  tagRects(camera, W, H, out = []) {
    const v = this._tv || (this._tv = new THREE.Vector3());
    for (const it of this.items.values()) {
      if (!it.el.isConnected || it.el.style.display === 'none') continue;
      if (it._mh !== it.html || !it._mw) { it._mw = it.el.offsetWidth || 0; it._mhH = it.el.offsetHeight || 0; it._mh = it.html; } // 아직 안 그려진(0) 것은 다음에 다시 잼
      if (!it._mw) continue;
      v.copy(it.label.position).add(it.g.position).project(camera);
      if (v.z < -1 || v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H; // center (0.5, 0): 위 가운데가 이 점
      out.push([x - it._mw / 2, y, x + it._mw / 2, y + it._mhH]);
    }
    return out;
  }

  /** 화면 좌표 → 섬 projectId (바닥 평면 교차, 노드 클릭이 우선이므로 app 은 pick() 이 null 일 때만 부른다) */
  pick(raycaster, opts = {}) {
    if (!raycaster.ray.intersectPlane(this._plane, this._hit)) return null;
    return pickIslandAt(this._pickable(opts), this._hit.x, this._hit.z, opts.pad || 0);
  }
  /** 나가는(숨는) 프로젝트 섬은 집지 않는다. opts.pid = 그 섬만(프로젝트 영역 판정) */
  _pickable(opts = {}) {
    const out = [];
    for (const it of this.items.values()) {
      const pid = it.c.projectId;
      if (opts.pid ? pid !== opts.pid : (this.pf && this.pf.out(pid))) continue;
      out.push(it.c);
    }
    return out;
  }

  _drop(pid, it) {
    this.group.remove(it.g);
    it.label.removeFromParent();
    it.el.remove();
    for (const m of [it.disc, it.ring, it.inner]) { m.material.dispose(); if (it.own) m.geometry.dispose(); }
    if (it.deco) { it.deco.geometry.dispose(); it.deco.material.dispose(); }
    this.items.delete(pid);
  }

  dispose() {
    for (const [pid, it] of [...this.items]) this._drop(pid, it);
    this.scene.remove(this.group);
  }
}
