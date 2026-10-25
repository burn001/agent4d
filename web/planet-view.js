// Planet 3D 표현 — SceneView 바탕 + 행성 연출(메인 = 기계 행성, 서브에이전트 = 대기·구름·위성) + 작업 대상 층.
// 행성 연출은 PlanetDeco(planet-deco.js)가 노드마다 덧붙이고, 흐름(FlowView)은 SceneView 를 따로 상속하므로 영향이 없다.
import { SceneView } from './scene.js';
import { PlanetArt3D } from './art-layer3d.js';
import { PlanetDeco } from './planet-deco.js';

export class PlanetView extends SceneView {
  static modeId = 'planet';
  static modeLabel = 'Planet';

  constructor(container, labelContainer) {
    super(container, labelContainer);
    this.deco = new PlanetDeco(this);
    for (const v of this.vis.values()) this.deco.attach(v);
    // 프레임 끝 렌더 직전 갈고리: 행성 연출 + (켰을 때) 작업 대상 층
    this._preRender = (now, dt) => { if (this.deco) this.deco.update(now, dt || 0.016); if (this.pArt) this.pArt.update(now); };
  }

  addNode(node, spawn = true) {
    super.addNode(node, spawn);
    const v = this.vis.get(node.id);
    if (v && this.deco) this.deco.attach(v);
  }
  _disposeVis(v) { if (this.deco) this.deco.detach(v); super._disposeVis(v); }

  /** {on, book, fx, style}: 켜면 층을 만들고, 끄면 걷는다 */
  setArtifacts({ on, book, fx, style } = {}) {
    if (on && !this.pArt && book && fx) {
      this.pArt = new PlanetArt3D(this.scene, this, { book, fx, style });
      import('./art-name3d.js').then((m) => { if (this.pArt && !this.pArt.names && m.NamePlates3D) { this.pArt.names = new m.NamePlates3D(this.pArt.group, this); this.pArt.names.applyTheme(this.pArt.isLight); } }).catch(() => {});
    } else if (!on && this.pArt) { this.pArt.dispose(); this.pArt = null; }
    return !!this.pArt;
  }
  get artOn() { return !!this.pArt; }
  pickArtifact(clientX, clientY) { return this.pArt ? this.pArt.pickAt(clientX, clientY) : null; }
  artPos(pid, id) { return this.pArt ? this.pArt.posOf(pid, id) : null; }
  setArtFoot(pid, nodeId) { if (this.pArt) this.pArt.st.setFoot(pid, nodeId); }
  setArtSelected(t) { if (this.pArt) this.pArt.st.sel = t || null; }
  fitExtra3d(pts, scope) { if (this.pArt) this.pArt.fitPoints(pts, scope); }
  applyTheme() { super.applyTheme(); if (this.pArt) this.pArt.applyTheme(this.tokens); if (this.deco) this.deco.applyTheme(); }
  dispose() { if (this.deco) { this.deco.dispose(); this.deco = null; } if (this.pArt) { this.pArt.dispose(); this.pArt = null; } super.dispose(); }
}
