// Planet 3D 표현 — SceneView 바탕 + 행성 연출(메인 = 기계 행성, 서브에이전트 = 대기·구름·위성) + 작업 대상 층.
// 행성 연출은 PlanetDeco(planet-deco.js)가 노드마다 덧붙이고, 흐름(FlowView)은 SceneView 를 따로 상속하므로 영향이 없다.
import { SceneView } from './scene.js';
import { PlanetArt3D } from './art-layer3d.js';
import { PlanetDeco } from './planet-deco.js';
import { bodyK, JOB_BODY_K } from './planet-core.mjs';
import { isJob } from './job-core.mjs'; // 작업 노드 = 작은 탐사선
const LABEL_NEAR_PX = 11;

export class PlanetView extends SceneView {
  static modeId = 'planet';
  static modeLabel = 'Planet';

  constructor(container, labelContainer) {
    super(container, labelContainer);
    this.deco = new PlanetDeco(this);
    for (const v of this.vis.values()) { this._planetBody(v); this.deco.attach(v); }
    // 홀로그램: 궤도계 바깥에 놓고, 궤도 위성이 투사하는 빛줄로 잇는다(흐름과 같은 HoloBook·문구, 그리기 위치만)
    this.holoBeam = true;
    this.holoR = (v) => v.r * v.size * Math.min(2.6, 0.55 + 0.6 * (this.deco ? this.deco.extentOf(v.id) : 1));
    // 빛줄 출발점 = 패널 쪽 궤도 둘레(노드 중심에서 패널 방향으로 궤도계 반지름의 0.8) — 위성 하나에서 여러 줄이 모이던 거미줄 대신 링에서 뻗는다
    this.holoFrom = (v, slot, out, p) => { if (!p) return false; const o = v.group.position; out.copy(p).sub(o); const L = out.length(); if (L < 1e-6) return false; const R = Math.min(L * 0.6, this.holoR(v) * 0.8); out.multiplyScalar(R / L).add(o); return true; };
    // 프레임 끝 렌더 직전 갈고리: 행성 연출 + (켰을 때) 작업 대상 층
    this._preRender = (now, dt) => { if (this.deco) this.deco.update(now, dt || 0.016); if (this.pArt) this.pArt.update(now); };
  }

  addNode(node, spawn = true) {
    super.addNode(node, spawn);
    const v = this.vis.get(node.id);
    if (v) this._planetBody(v);
    if (v && this.deco) this.deco.attach(v);
  }
  /** 본체 축소: 그리는 반지름(v.r)만 줄인다 — 배치 간격(RADIUS)은 그대로, 클릭·라벨·홀로그램·연결선·카메라·선택 페이드가 v.r 을 따른다 */
  _planetBody(v) {
    if (v._plR) return;
    v._plR = true;
    v.r *= isJob(v.node) ? JOB_BODY_K : bodyK(v.kind, !!v.device); // 작업은 백그라운드 명령 위성보다 작게
    const r = v.r;
    if (v.kind === 'bash-bg' || v.kind === 'monitor') v.label.position.set(0, -r * 1.2 - 0.4, 0);
    else v.label.position.set(0, r * 1.2 + 0.5, 0);
    v.mesh.scale.setScalar(r);
  }
  /** 작업 노드: scene 기본 색칠(종류 색·상태 흐림) 뒤에 표시 상태 색(렌더러 시계)으로 덮는다 — PlanetDeco.jobStyle */
  _styleVis(v) { super._styleVis(v); if (this.deco && isJob(v.node)) this.deco.jobStyle(v); }
  _disposeVis(v) { if (this.deco) this.deco.detach(v); super._disposeVis(v); }
  /** 가까이서 보면 라벨이 궤도선·소행성대 위에 얹히던 것 — 본체 화면 반지름 px 가 궤도계가 다 보이는 크기(LABEL_NEAR_PX,
   *  orbitLod 2 단계와 같은 11px)를 넘으면 라벨을 궤도 쪽으로 조금 띄우고(본체 px × 0.5, 상한 34px) 라벨 뒤에 배경색 옅은 번짐(.pl-halo) */
  _labelGapPx(v, px) {
    const near = px >= LABEL_NEAR_PX;
    if (near !== !!v._plNear) { v._plNear = near; v.labelEl.classList.toggle('pl-halo', near); }
    return near ? Math.round(Math.min(34, px * 0.5)) : 0;
  }

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
