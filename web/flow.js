// 흐름 연출(도형 모드). Flow 식: 연결선 위로 오가는 패킷(호출↓·결과↑)과 잔광.
// 도구 사용은 홀로그램 모니터(holo.js)가 맡는다(예전 '도구 가지'는 없앰). 그리기는 InstancedMesh 2개(머리·잔광) — 그리기 호출 2번.
import * as THREE from 'three';
import { FLOW, PacketPool, planFlow, linkPoint, trailUs, easeInOut } from './flow-core.mjs';
import { DEG, degOfLink, packetGone } from './degrade-core.mjs';

const HEAD_R = 0.3;

export class FlowLayer {
  /**
   * @param scene  THREE.Scene
   * @param view   SceneView (vis·tokens·children 를 읽기만)
   */
  constructor(scene, view) {
    this.view = view;
    this.pool = new PacketPool(FLOW.MAX_PACKETS, FLOW.PER_NODE);
    this.state = { lastUp: new Map(), lastOut: new Map() };
    this.enabled = true;
    const geo = new THREE.SphereGeometry(1, 10, 8);
    this.headMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.trailMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.85 });
    this.heads = new THREE.InstancedMesh(geo, this.headMat, FLOW.MAX_PACKETS);
    this.trail = new THREE.InstancedMesh(geo, this.trailMat, FLOW.MAX_PACKETS * FLOW.TRAIL);
    for (const m of [this.heads, this.trail]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 3;
    }
    scene.add(this.heads, this.trail);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
    this._pt = { x: 0, y: 0, z: 0 };
    this.applyTheme(view.tokens);
  }

  applyTheme(t) {
    this.tokens = t;
    const blend = t.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [this.headMat, this.trailMat]) if (m.blending !== blend) { m.blending = blend; m.needsUpdate = true; }
  }

  _colorOf(p) {
    const t = this.tokens;
    switch (p.color) {
      case 'call': return t['flow-call'];
      case 'ok': return t.ok;
      case 'error': return t.error;
      case 'stopped': return t.stopped;
      case 'output': return t['k-bash-bg'];
      default: return t.text;
    }
  }

  /** 이벤트 하나 반영(app.onEvent → view.flowEvent) */
  event(ev, { speed = 1 } = {}) {
    if (!this.enabled) return;
    const view = this.view;
    const now = performance.now() / 1000;
    const plans = planFlow(ev, {
      has: (id) => { const v = view.vis.get(id); return !!v && !v.hidden; },
      parentOf: (id) => { const v = view.vis.get(id); return v ? v.node.parentId : null; },
      activeChild: (id) => {
        const kids = view.children(id);
        for (let i = kids.length - 1; i >= 0; i--) { const cv = view.vis.get(kids[i]); if (cv && !cv.hidden && cv.node.status === 'active') return cv.id; }
        return null;
      },
      now, speed, state: this.state,
    });
    const dur = FLOW.LINK_DUR / Math.min(2, Math.max(1, Math.sqrt(speed)));
    for (const pl of plans) {
      if (pl.kind !== 'link') continue;
      const s = this.pool.alloc(pl.from, now);
      s.kind = pl.kind;
      s.from = pl.from; s.to = pl.to; s.color = pl.color; s.size = pl.size || 1; s.dur = dur;
      s.arc = pl.dir === 'up' ? -FLOW.ARC : FLOW.ARC;
    }
  }

  clear() { this.pool.clear(); this.state.lastUp.clear(); this.state.lastOut.clear(); }

  _put(mesh, i, p, scale, col) {
    this._s.setScalar(scale);
    this._m.compose(p, this._q, this._s);
    mesh.setMatrixAt(i, this._m);
    mesh.setColorAt(i, col);
  }

  update(now) {
    const view = this.view;
    const bg = this.tokens.bg;
    let nh = 0, nt = 0;
    const pt = this._pt;
    const dead = [];
    for (const s of this.pool.active) {
      const t = now - s.t0;
      // 연결선 왕복 패킷
      const fv = view.vis.get(s.from), tv = view.vis.get(s.to);
      if (!fv || !tv || fv.hidden || tv.hidden) { dead.push(s); continue; }
      const u = t / s.dur;
      if (u >= 1) { dead.push(s); continue; }
      const e = easeInOut(Math.max(0, u));
      // 신호 열화: 그 세션 흐름선 위 패킷이 중간 구간에서 사라졌다 다시 나타남(소실)
      if (DEG.on && !DEG.reduced && packetGone((s.t0 * 1000) | 0, u, degOfLink(s.from, s.to))) continue;
      const a = fv.group.position, b = tv.group.position;
      const col = this._colorOf(s);
      const lp = view.linkPath || linkPoint; // 흐름 표현은 곡선 빔 위로
      lp(pt, a, b, e, s.arc);
      this._p.set(pt.x, pt.y, pt.z);
      this._put(this.heads, nh++, this._p, HEAD_R * 1.35 * s.size * (u > 0.88 ? (1 - u) / 0.12 * 0.6 + 0.4 : 1), col);
      const us = trailUs(e);
      for (let i = 0; i < us.length && nt < this.trail.instanceMatrix.count; i++) {
        lp(pt, a, b, us[i], s.arc);
        this._p.set(pt.x, pt.y, pt.z);
        const f = (i + 1) / (FLOW.TRAIL + 1);
        this._put(this.trail, nt++, this._p, HEAD_R * 1.1 * s.size * (1 - f * 0.75), this._c2.copy(col).lerp(bg, f));
      }
    }
    for (const s of dead) this.pool.release(s);
    this.heads.count = nh; this.trail.count = nt;
    if (nh) { this.heads.instanceMatrix.needsUpdate = true; this.heads.instanceColor.needsUpdate = true; }
    if (nt) { this.trail.instanceMatrix.needsUpdate = true; this.trail.instanceColor.needsUpdate = true; }
  }

  dispose() {
    for (const m of [this.heads, this.trail]) { m.removeFromParent(); m.geometry.dispose(); }
    this.headMat.dispose(); this.trailMat.dispose();
    this.pool.clear();
  }
}
