// 흐름(Flow) 3D 네모 터미널(백그라운드 명령 bash-bg) 앞면 글. 가까울 때만(LOD) 실제 출력 줄이 앞면에 흐른다.
// 몸(네모 상자)은 chips.js 실루엣 묶음이 그리고, 여기선 화면에 크게 보이는 몇 개에만 작은 글 판(캔버스 텍스처)을 붙인다.
// 글 = 그 노드의 최근 출력 꼬리(output 이벤트 panel.lines / text — 서버가 redact, minimal 이면 빈 글) 위에 명령 한 줄('$ 라벨').
import * as THREE from 'three';
import { SIL_DIM } from './shape-core.mjs';

export const TERM = { LOD_PX: 26, MAX: 10, FPS: 4, LINES: 3, W: 384, H: 100 };

export class TermFaces {
  constructor(scene, view) {
    this.scene = scene; this.view = view;
    this.tails = new Map(); // nodeId → 최근 줄들
    this.pool = [];
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.isLight = false;
    this._cand = [];
  }
  applyTheme(isLight) { this.isLight = !!isLight; this._white = null; for (const p of this.pool) { p.mat.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending; p.mat.needsUpdate = true; p.key = ''; } }
  /** output 이벤트 → 꼬리 줄(노드별 최근 TERM.LINES 줄) */
  event(ev) {
    if (!ev || ev.type !== 'output' || !ev.nodeId) return;
    let ls = null;
    if (ev.panel && Array.isArray(ev.panel.lines)) ls = ev.panel.lines.map(String);
    else if (ev.text) ls = String(ev.text).split(/\r?\n/);
    if (!ls) return;
    ls = ls.map((s) => s.replace(/\s+$/, '')).filter((s) => s.trim());
    if (!ls.length) return;
    const old = this.tails.get(ev.nodeId) || [];
    const next = ev.panel ? ls : old.concat(ls);
    this.tails.set(ev.nodeId, next.slice(-TERM.LINES * 2));
    if (this.tails.size > 400) this.tails.delete(this.tails.keys().next().value);
  }
  clear() { this.tails.clear(); }
  _slot(i) {
    let p = this.pool[i];
    if (p) return p;
    const c = document.createElement('canvas'); c.width = TERM.W; c.height = TERM.H;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.geo, mat); mesh.raycast = () => {}; mesh.renderOrder = 1.7; mesh.visible = false;
    this.scene.add(mesh);
    p = this.pool[i] = { c, x: c.getContext('2d'), tex, mat, mesh, key: '', at: 0 };
    return p;
  }
  _draw(p, v, now) {
    const lines = this.tails.get(v.id) || [];
    const head = '$ ' + String(v.node.label || v.node.text || 'bash').replace(/\s+/g, ' ').slice(0, 40);
    const key = v.id + '|' + head + '|' + lines.join('\n');
    const scroll = lines.length > TERM.LINES - 1 && !this.view.reduced ? Math.floor(now * 1.2) % Math.max(1, lines.length - (TERM.LINES - 2)) : 0;
    if (key === p.key && scroll === p.scroll) return;
    if (now - p.at < 1 / TERM.FPS && p.key) return; // 다시 그리기 상한
    p.key = key; p.scroll = scroll; p.at = now;
    const { x, c } = p;
    x.clearRect(0, 0, c.width, c.height);
    x.font = '600 25px "JetBrains Mono", D2Coding, Consolas, ui-monospace, monospace'; x.textBaseline = 'top';
    x.fillStyle = '#fff'; x.globalAlpha = 0.95;
    x.fillText(head, 10, 6);
    const show = lines.slice(scroll, scroll + TERM.LINES - 1);
    show.forEach((s, i) => { x.globalAlpha = 0.55 + 0.4 * ((i + 1) / show.length); x.fillText('> ' + s.slice(0, 26), 10, 36 + i * 30); });
    x.globalAlpha = 1;
    p.tex.needsUpdate = true;
  }
  update(now) {
    const view = this.view, cam = view.camera, H = view.container.clientHeight || 1;
    const f = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const cand = this._cand; cand.length = 0;
    for (const v of view.vis.values()) {
      if (v._sil !== 'term' || v.gone || v.hidden || !v.group.visible) continue;
      const d = Math.max(0.01, v.group.position.distanceTo(cam.position));
      const px = ((v._sz || v.mesh.scale.x) * f) / d;
      if (px >= TERM.LOD_PX && (v._alphaK ?? 1) > 0.05) { v._termPx = px; cand.push(v); }
    }
    cand.sort((a, b) => b._termPx - a._termPx);
    const n = Math.min(TERM.MAX, cand.length);
    const [bx, bz] = SIL_DIM.term.box, th = SIL_DIM.term.h;
    for (let i = 0; i < n; i++) {
      const v = cand[i], p = this._slot(i);
      this._draw(p, v, now);
      const s = v._sz || v.mesh.scale.x, yaw = v._yaw || 0;
      const o = v.group.position;
      p.mesh.position.set(o.x + Math.sin(yaw) * (bz * s + 0.02), o.y, o.z + Math.cos(yaw) * (bz * s + 0.02));
      p.mesh.rotation.set(0, yaw, 0);
      p.mesh.scale.set(bx * 2 * s * 0.92, th * s * 0.86, 1);
      p.mat.color.copy(view.kindColor('bash-bg')).lerp(this._white || (this._white = new THREE.Color(this.isLight ? 0x0b2a44 : 0xffffff)), this.isLight ? 0.6 : 0.35);
      p.mat.opacity = Math.min(1, (v._alphaK ?? 1) * Math.min(1, (v._termPx - TERM.LOD_PX) / 10 + 0.3));
      p.mesh.visible = true;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].mesh.visible = false;
  }
  dispose() { for (const p of this.pool) { p.mesh.removeFromParent(); p.mat.dispose(); p.tex.dispose(); } this.pool = []; this.geo.dispose(); }
}
