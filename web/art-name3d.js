// 바닥 글씨 3D — 섬마다 프로젝트 이름을 바닥 평면에 눕힌 캔버스 텍스처 판. 표현 공용(흐름 3D 가 쓰고, Planet 3D 도 그대로 쓸 수 있음):
//   const names = new NamePlates3D(group, view);   names.update(pids, targetOf, f, nowSec, dt, {y, reduced});   names.applyTheme(isLight);   names.dispose();
//   targetOf(pid) → {x, z, hw, hd}(섬 중심·반폭·반깊이), f = 화면 높이 / (2·tan(fov/2)), y = 글씨 높이(대상 바닥보다 살짝 아래).
// 카메라 방위가 글씨 방향과 크게 벌어지면 가장 가까운 90° 단위로 부드럽게(≈0.6초) 돌아 늘 바로 읽힘.
import * as THREE from 'three';
import { ART, artNamePlateYaw, artNameReadable, artNameYaw, artAngleStep } from './artifact-core.mjs';
import { projectNameOf, nameCanvas, dimIslandLabel, undimAll } from './art-name.js';

export class NamePlates3D {
  constructor(group, view) {
    this.group = group; this.view = view;
    this.M = new Map(); // pid → {name, mesh, mat, tex, geo, aspect, lines, yaw, yawT}
    this.isLight = false;
    this._dimAt = 0;
  }
  applyTheme(isLight) { this.isLight = !!isLight; for (const e of this.M.values()) this._style(e); }
  _style(e) {
    // 저휘도: 흰 글자(옅은 채움 + 윤곽) × 재질색. 다크 가산·라이트 일반 혼합, 글로우 없음
    e.mat.color.set(this.isLight ? '#475569' : '#8a96aa');
    e.baseOp = this.isLight ? 0.3 : 0.42;
    e.mat.opacity = e.baseOp * (e.fa ?? 1);
    e.mat.blending = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    e.mat.needsUpdate = true;
  }
  _drop(e) { this.group.remove(e.mesh); e.geo.dispose(); e.mat.dispose(); e.tex.dispose(); }
  update(pids, targetOf, f, now, dt, { y = ART.FLOOR_Y + ART.NAME_Y, reduced = false } = {}) {
    const v = this.view, cam = v.camera, root = v.labelContainer || document;
    const dimNow = now - this._dimAt > 0.25;
    if (dimNow) this._dimAt = now;
    const keep = new Set();
    for (const pid of pids) {
      const name = projectNameOf(v, pid);
      const t = targetOf(pid);
      if (!name || !t) continue;
      keep.add(pid);
      let e = this.M.get(pid);
      if (!e || e.name !== name) {
        if (e) this._drop(e);
        const nc = nameCanvas(name);
        if (!nc) continue;
        const tex = new THREE.CanvasTexture(nc.canvas);
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.3 });
        const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = -1; mesh.frustumCulled = false;
        this.group.add(mesh);
        e = { name, mesh, mat, tex, geo, aspect: nc.aspect, lines: nc.lines.length, yaw: null, yawT: null };
        this.M.set(pid, e);
        this._style(e);
      }
      // 방향: 섬 중심 → 카메라 방위의 가장 가까운 90° 단위(경계 근처는 그대로), 부드럽게 돎
      e.yawT = artNameYaw(cam.position.x - t.x, cam.position.z - t.z, e.yawT);
      e.yaw = artAngleStep(e.yaw, e.yawT, dt, reduced);
      const pl = artNamePlateYaw(t, e.aspect, e.yawT);
      if (!pl) { e.mesh.visible = false; continue; }
      const fa = v.projAlpha ? v.projAlpha(pid) : 1; // 프로젝트 페이드
      if (fa !== (e.fa ?? 1)) { e.fa = fa; e.mat.opacity = (e.baseOp ?? 0.3) * fa; }
      e.mesh.visible = fa > 0;
      e.mesh.position.set(t.x, y, t.z);
      e.mesh.rotation.y = e.yaw;
      e.mesh.scale.set(pl.w, 1, pl.h);
      if (dimNow && v.scope && v.scope.mode === 'all') {
        const d = Math.hypot(cam.position.x - t.x, cam.position.y - y, cam.position.z - t.z) || 1;
        dimIslandLabel(root, pid, artNameReadable(((pl.h / e.lines) * f) / d));
      }
    }
    for (const [pid, e] of this.M) if (!keep.has(pid)) { this._drop(e); this.M.delete(pid); dimIslandLabel(root, pid, false); }
  }
  dispose() { for (const e of this.M.values()) this._drop(e); this.M.clear(); undimAll(this.view.labelContainer || document); }
}
