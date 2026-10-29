// 복셀 3D 바닥 스텐실: 동(프로젝트)마다 첫 사무실 앞쪽 빈 바닥에 프로젝트 이름 페인트 글씨.
// 텍스처 = stencil-tex.js 흰 마스크(이름이 바뀔 때만 다시), 재질 색·불투명도 = 테마· 페이드. 바닥 위 데칼(깊이 쓰기 없음 + polygonOffset).
import * as THREE from 'three';
import { stencilTargets, stencilLines, stencilPlace, stencilStyle } from './stencil-core.mjs';
import { stencilMask } from './stencil-tex.js';
import { stencilOn, onStencil } from './stencil-pref.mjs';

const Y = 0.016; // 카펫(윗면 0.015～0.016) 위, 바닥 조명 라인(0.022) 아래
const PLANE = new THREE.PlaneGeometry(1, 1);

export class VxStencil {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.group.name = 'vx-stencil';
    this.group.renderOrder = 1;
    view.scene.add(this.group);
    this.items = new Map(); // key → { mesh, mat, tex, text, pid, place }
    this.texes = new Map(); // mask key → THREE.CanvasTexture
    this.sig = '';
    this.on = stencilOn();
    this._off = onStencil((v) => { this.on = v; this.group.visible = v; this.sig = ''; });
    this.group.visible = this.on;
  }

  _tex(mask) {
    let t = this.texes.get(mask.key);
    if (t) return t;
    t = new THREE.CanvasTexture(mask.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.view.renderer.capabilities.getMaxAnisotropy ? this.view.renderer.capabilities.getMaxAnisotropy() : 1);
    this.texes.set(mask.key, t);
    return t;
  }

  /** 배치·이름이 바뀌었을 때만 다시 놓기(매 프레임 부름 — 서명 비교만) */
  sync() {
    const v = this.view, lay = v.layout;
    if (!this.on || !lay) { if (this.items.size) this._clear(); return; }
    const mode = v.scope && v.scope.mode === 'all' ? 'all' : 'session';
    const root = mode === 'session' && lay.rootId ? v.nodes.get(lay.rootId) : null;
    // 서명 = 정적 서명(배치·테마) + 배치 객체·범위 객체(다시 배치·setScope 마다 새것 — 이름 바뀜 포함) + 루트 cwd. 매 프레임 문자열을 새로 만들지 않고 값만 비교
    const cwd = root && root.meta ? root.meta.cwd || '' : '';
    if (this.sig === v.staticSig && this._cwd === cwd && this._mode === mode && this._scope === v.scope && this._lay === lay && v.staticSig) return;
    this.sig = v.staticSig; this._cwd = cwd; this._mode = mode; this._scope = v.scope; this._lay = lay; // scope 는 setScope 마다 새 객체(이름 바뀜)
    const targets = stencilTargets(lay, { mode, root, projects: v.scope && v.scope.projects });
    const keep = new Set();
    for (const tg of targets) {
      const lines = stencilLines(tg.text);
      if (!lines.length) continue;
      const mask = stencilMask(lines);
      const pl = stencilPlace(tg.room, lines, mask.aspect);
      if (!pl) continue;
      keep.add(tg.key);
      let it = this.items.get(tg.key);
      if (!it) {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        const mesh = new THREE.Mesh(PLANE, mat);
        mesh.rotation.order = 'YXZ';
        mesh.renderOrder = 1;
        mesh.raycast = () => {}; // 클릭은 바닥·동 판정 그대로
        this.group.add(mesh);
        it = { mesh, mat, key: tg.key };
        this.items.set(tg.key, it);
      }
      const tex = this._tex(mask);
      if (it.mat.map !== tex) { it.mat.map = tex; it.mat.needsUpdate = true; }
      it.pid = tg.projectId; it.place = pl;
      it.mesh.position.set(pl.x, Y, pl.z);
      it.mesh.rotation.set(-Math.PI / 2, -pl.angle, 0);
      it.mesh.scale.set(pl.w, pl.h, 1);
    }
    for (const [k, it] of this.items) if (!keep.has(k)) { this.group.remove(it.mesh); it.mat.dispose(); this.items.delete(k); }
    this._style();
  }

  /** 테마·페이드 — 매 프레임(값만 바꿈) */
  _style() {
    const v = this.view, all = v.scope && v.scope.mode === 'all', L = !!(v.tokens && v.tokens.isLight);
    for (const it of this.items.values()) {
      const fade = all && it.pid ? v.pf.alpha(it.pid) : 1;
      const focus = all && it.pid && v.pf.focus === it.pid;
      const st = stencilStyle(L, fade, focus);
      if (it._c !== st.color) { it.mat.color.set(st.color); it._c = st.color; }
      if (it.mat.opacity !== st.alpha) it.mat.opacity = st.alpha;
      const vis = st.alpha > 0.005;
      if (it.mesh.visible !== vis) it.mesh.visible = vis;
    }
  }

  frame() { if (!this.on) return; this.sync(); this._style(); }
  applyTheme() { this._style(); }

  _clear() {
    for (const it of this.items.values()) { this.group.remove(it.mesh); it.mat.dispose(); }
    this.items.clear();
  }
  dispose() {
    this._clear();
    for (const t of this.texes.values()) t.dispose();
    this.texes.clear();
    if (this._off) this._off();
    this.view.scene.remove(this.group);
  }
}
