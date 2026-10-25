// '흐름(Flow)' 표현. 새 기본 표현.
// agent-flow(patoles/agent-flow) 의 시각 언어(깊은 남색 허공 · 육각 노드 · 가늘어지는 곡선 빔 · 혜성 꼬리 입자 · 상태색 · 노드 옆 말풍선)를
// 이 저장소의 3D 장면 위에 얹는다. 데이터·배치·카메라·퇴장·홀로그램 패널·흐름 패킷·라벨(작업 한 줄·이력)·전체 보기 섬은 SceneView 를
// 그대로 물려받고, 그림만 바꾼다: 3D 도형 → 육각 칩(chips.js), 직선 → 곡선 빔(beams.js), 격자 바닥 → 허공 배경(backdrop.js), 말풍선(bubbles.js).
import { t as _t } from '../i18n.mjs';
import { SceneView } from '../scene.js';
import { NodeChips } from './chips.js';
import { Beams } from './beams.js';
import { Backdrop } from './backdrop.js';
import { Bubbles } from './bubbles.js';
import { paletteOf, beamPoint, packetWobble } from './flow-style.mjs';
import { textWidth } from '../label-place.mjs';
import { ArtLayer3D } from './artifacts.js'; // 작업 대상 층(켤 때만 만든다)
import { TIER, tierGap, tierY, tierDepths, tierDim, tierSpan } from './tier-core.mjs'; // 높이 계층
import { isDetachedRoot } from '../layout.js';
import { isJob } from '../job-core.mjs';
import { JOB_CHIP } from './job-chip-core.mjs'; // 작업 칩

const CHIP_SCALE = 1.45;
const PANEL_TOP_PX = 96; // 맨 위 노드 위 홀로그램 패널 자리(px)
// 메인은 배치 반경(RADIUS 3.0)이 커서 같은 배율이면 서브에이전트의 1.9배 — 칩만 1.2배 정도로 줄인다
const CHIP_SCALE_KIND = { main: 0.95, 'claude-p': 1.25, workflow: 1.1 };
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./flowview.css', import.meta.url).href;
  document.head.appendChild(l);
}

export class FlowView extends SceneView {
  static modeId = 'flow';
  static modeLabel = _t('scene.mode.flow');

  constructor(container, labelContainer) {
    super(container, labelContainer);
    ensureCss();
    this.labelContainer = labelContainer;
    labelContainer.classList.add('flow-mode');
    // 3D 답게: 예전 52～72°(거의 내려다봄 — 2D 를 비스듬히 찍은 것과 같았다) → 26～44°. 높이 계층(메인 위·자손 아래층·바닥 대상 층)이
    // 옆에서 읽히는 고도. 자동 카메라가 쉬는 동안 느린 왕복 궤도(idleOrbit: 진폭 도·주기 초, 움직임 줄이기면 없음 — camera.js)
    this._camSession = { ...this.cameraPrefs, elevMin: 26, elevMax: 44, distMin: 10, idleOrbit: { amp: 16, period: 46 } };
    // 전체 보기는 32～46°: 섬 팩 배치가 낮은 고도에서 섬을 세로 한 줄로 쌓는데, 층 높이(섬마다 ~20)가 줄마다 더해져 섬끼리 겹쳤다
    this._camAll = { ...this._camSession, elevMin: 32, elevMax: 46 };
    this.cameraPrefs = this._camSession;
    this.tierFloor = TIER.FLOOR;    // 바닥(대상 층·섬 판·바닥 격자·그림자) 높이
    this.packHy = tierSpan(tierGap(30)) + 2; // 섬 팩 배치가 볼 높이 범위(첫 배치 전 추정, _relayout 이 갱신)
    this.compactPx = 0;            // 라벨이 보이는 노드는 작업 한 줄을 늘 보인다
    this.layoutSpread = 1.5;      // 단일 세션 배치 간격(텍스트 자리)
    this.overviewSpread = 1.3;    // 전체 보기 섬 안 간격(예전 1 — 라벨이 이웃 칩에 걸침)
    this.overviewFacing = true;   // 같은 섬 live 메인 여럿: 마주 보기(2～3)·파이 구역(4)
    this.holoToolTethers = true;   // 노드 → 도구 패널 빔
    this.holoMiniLabels = false;   // 작업 줄이 라벨에 늘 있으므로 작은 패널 라벨은 생략
    this.labelBelow = true;        // 노드 라벨이 칩 아래 — 아래쪽(에이전트) 패널은 라벨만큼 더 띄움
    this._labelFontPx = 11;        // 라벨 글자 크기(이름만 모드 폭 추정)
    // 흐름 패킷은 곡선 빔 위로: 호출(arc>0)은 부모→자식, 결과(arc<0)는 같은 빔을 거꾸로
    // 패킷은 빔 위를 가며 진행 수직으로 살짝 흔들린다(agent-flow wobble)
    // 높이 계층: 패킷도 빔과 같은 떨어지는 곡선(beamPoint drop)
    this.linkPath = (out, a, b, u, arc) => { const w = this.reduced ? 0 : packetWobble(arc < 0 ? 1 - u : u, performance.now() / 1000); return arc < 0 ? beamPoint(out, b, a, 1 - u, w, true) : beamPoint(out, a, b, u, w, true); };
    this.linkLines.visible = false;
    this.dashLines.visible = false;
    this.dots.visible = false;
    this.chips = new NodeChips(this.scene, this);
    this.beams = new Beams(this.scene, this);
    if (this.spawnLines) this.spawnLines.renderOrder = 2; // 칩 깊이 패스(1.5) 다음
    if (this.spawnMat) this.spawnMat.opacity = 0.22; // 위계: 충돌 곡선 > 패킷 > 일반 연결선 > 띄움 점선
    this.backdrop = new Backdrop(this.scene, this);
    this.bubbles = new Bubbles(this.scene, this);
    for (const v of this.vis.values()) this._flowNode(v);
    this.applyTheme();
  }

  // ---- 3D 도형은 숨기고(클릭 판정용 메시는 남김) 칩이 그린다 ----
  _flowNode(v) {
    // 칩은 단순 도형보다 크게(노드 축소 0.68 을 되돌린 크기 — 글자와 균형)
    // 작업 노드는 백그라운드 명령 칩보다 작은 작업 칩(JOB_CHIP.SCALE)
    if (!v._flowR) { v.r *= (v.device ? 1.6 : CHIP_SCALE_KIND[v.kind] ?? CHIP_SCALE) * (isJob(v.node) ? JOB_CHIP.SCALE : 1); v._flowR = true; }
    v.mesh.visible = false;
    for (const k of Object.keys(v.extras)) v.group.remove(v.extras[k]);
    // 라벨은 칩 아래(agent-flow 처럼 이름이 노드 밑). 화면 간격은 _labelPass 에서 칩 크기에 맞춤
    v.label.center.set(0.5, 0);
    v.label.position.set(0, 0, 0);
  }
  addNode(node, spawn = true) {
    const had = this.vis.has(node.id);
    super.addNode(node, spawn);
    const v = !had && this.vis.get(node.id);
    if (v) this._flowNode(v);
  }
  _syncSkill(v) {
    super._syncSkill(v);
    if (v.sat) { v.sat.obj.visible = false; v.sat.label.visible = false; }
  }
  setScope(scope = {}) {
    if (this._camAll) this.cameraPrefs = scope.mode === 'all' ? this._camAll : this._camSession; // 카메라는 객체가 바뀌면 다시 읽는다
    super.setScope(scope);
  }
  removeNode(id) { super.removeNode(id); if (this.bubbles) this.bubbles.drop(id); }
  reset() { super.reset(); if (this.bubbles) this.bubbles.clear(); }
  say(id, text, opts = {}) { if (this.bubbles) this.bubbles.say(id, text, opts); }
  /** 작업 줄: 말풍선이 떠 있으면 말 한 줄은 빼고 도구만(같은 말을 두 번 보이지 않게) */
  _actHtml(v) {
    if (this.bubbles && this.bubbles.shown.has(v.id) && !v.icons.size) return '';
    return super._actHtml(v);
  }

  // ---- 작업 대상 층(섬 바닥층). 끄면 객체가 없고 그리기·맞춤에 아무것도 더하지 않는다 ----
  /** {on, book, fx}: 켜면 층을 만들고, 끄면 걷는다(새로고침 없이 즉시) */
  setArtifacts({ on, book, fx, style } = {}) {
    if (on && !this.art && book && fx) { this.art = new ArtLayer3D(this.scene, this, { book, fx, style }); this.art.applyTheme(this.tokens); }
    else if (!on && this.art) { this.art.dispose(); this.art = null; }
    return !!this.art;
  }
  get artOn() { return !!this.art; }
  /** 화면 좌표 → 대상 {pid, id} | null */
  pickArtifact(clientX, clientY) {
    if (!this.art) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    return this.art.pick(this.raycaster);
  }
  artPos(pid, id) { return this.art ? this.art.posOf(pid, id) : null; }
  setArtFoot(pid, nodeId) { if (this.art) this.art.st.setFoot(pid, nodeId); }
  setArtSelected(t) { if (this.art) this.art.st.sel = t || null; }
  /** 카메라 맞춤(_fitPts·_clusterPts)에 바닥층 모서리 */
  fitExtra3d(pts, scope) { if (this.art) this.art.fitPoints(pts, scope); }

  applyTheme() {
    super.applyTheme();
    if (this.art) this.art.applyTheme(this.tokens);
    if (!this.chips) return;
    const t = this.tokens;
    const P = paletteOf(t.isLight);
    this.scene.background.set(P.void);
    t.bg.set(P.void);               // 패킷 잔광·빔이 배경색으로 섞일 때 기준
    this.scene.fog.color.set(P.void);
    if (this.grid) this.grid.visible = false;
    // 흐름 패킷 색: 호출 = 보라(dispatch), 결과 = 초록(return), 출력 = 하늘
    t['flow-call'].set(P.dispatch); t.ok.set(P.ret); t['k-bash-bg'].set(P.output);
    if (this.flow) this.flow.applyTheme(t);
    if (this.holo) this.holo.applyTheme(t);
    this.chips.applyTheme(t.isLight);
    this.beams.applyTheme(t.isLight, t.bg);
    this.backdrop.applyTheme(t.isLight);
    const ls = this.labelContainer.style;
    ls.setProperty('--flow-text', P.text); ls.setProperty('--flow-dim', P.textDim); ls.setProperty('--flow-holo', P.holo);
    ls.setProperty('--flow-tool', P.tool); ls.setProperty('--flow-bg', t.isLight ? 'rgba(255,255,255,.82)' : 'rgba(5,5,16,.72)');
  }

  _relayout() {
    const fresh = [];
    for (const v of this.vis.values()) if (v.fresh) fresh.push(v);
    super._relayout();
    // 새 노드 중 부모 자리에서 나오지 않고 제자리에 놓인 것(SceneView 가 배치 좌표를 그대로 복사) — 아래에서 고친 목표로 다시 놓는다
    const placed = fresh.filter((v) => !v.fresh && v.group.position.distanceToSquared(v.target) < 1e-9);
    // 단일 세션은 간격을 조금 넓혀 글자 자리
    const all = this.scope.mode === 'all';
    const k = all ? 1 : this.layoutSpread;
    if (k !== 1) for (const v of this.vis.values()) { v.target.x *= k; v.target.z *= k; }
    // 높이 계층: 트리 깊이마다 한 층씩 아래(메인이 가장 높음). 층 간격은 섬 반경 비례(전체 보기는 가장 큰 활성 섬 — 섬끼리 같은 높이)
    let R = 0;
    if (all) { for (const c of this._clusters || []) if (!c.inactive) R = Math.max(R, c.box ? Math.max(c.box.hw, c.box.hd) : c.r || 0); }
    else {
      const rv = this.layoutRoot && this.vis.get(this.layoutRoot), o = rv ? rv.target : null;
      for (const v of this.vis.values()) if (o && !v.gone) R = Math.max(R, Math.hypot(v.target.x - o.x, v.target.z - o.z));
    }
    const gap = this.tierGap = tierGap(R);
    this.packHy = tierSpan(gap) + 2;
    const po = this.parentOf || new Map(), ov = all ? this._ov : null;
    const host = (id) => {
      const v = this.vis.get(id), n = v && v.node;
      if (!n || !isDetachedRoot(n)) return null;
      const sp = n.meta && n.meta.spawnedBy;
      return (sp && this.vis.has(sp) && sp) || (ov && ov.rootOf && ov.rootOf.get(id)) || this.layoutRoot || null;
    };
    const depth = tierDepths(this.vis.keys(), (id) => po.get(id) || null, host);
    for (const v of this.vis.values()) {
      const d = depth.get(v.id) || 0;
      v.tierD = d; v.tierDim = tierDim(d);
      v.target.y = tierY(d, gap);
    }
    for (const v of placed) v.group.position.copy(v.target);
  }

  /** 맞춤 띠 위쪽에 홀로그램 패널 자리(노드 위로 뜸) — 낮은 고도에서 맨 위(메인) 패널이 화면 위로 잘리던 것 */
  labelReserve() {
    const r = this._labRes, top = PANEL_TOP_PX;
    return r ? { ...r, top: Math.max(r.top || 0, top) } : { top, bottom: 0, left: 0, right: 0 };
  }

  _updateLinks() { if (this.beams) this.beams.update(); this._updateSpawnLinks(this.tokens); } // 띄움 점선은 SceneView 것 그대로
  /** 라벨이 피할 말풍선 자리 */
  _extraRects(rects, W, H) { if (this.bubbles) this.bubbles.baseRects(this.camera, W, H, rects); }

  /** 라벨 겹침 상자 폭: 이름·작업 줄 중 긴 쪽(대략 글자 수) */
  _labelBoxW(v, compact) {
    const n = v.node;
    const nameW = Math.max(86, textWidth(String(n.label || n.id).slice(0, 24), 11));
    const actEl = compact ? null : v.labelEl.querySelector('.act');
    const actW = actEl ? Math.min(260, textWidth(actEl.textContent, 10.5) + 18) : 0;
    const stW = v.subTitle ? Math.min(compact ? 160 : 220, textWidth(v.subTitle, 9.5) + 8) : 0; // 부제는 CSS 말줄임으로 220px 안
    return Math.max(nameW, actW, stW) + 14;
  }

  /** 라벨은 칩 아래에 칩 화면 반지름만큼 띄워 붙는다(아래 _labelPass 와 같은 식) — 배치가 실제 자리로 판정하게 */
  _labelGapPx(v, px) { return Math.round(Math.min(90, px * 1.25 + 4)); }
  _discK(v) { return v.device ? 1.6 : 1.15; } // 육각 칩·배치 장치 상자(가로로 넓음)

  _labelPass(now) {
    super._labelPass(now);
    // 라벨을 칩 바로 아래로: 칩의 화면 반지름만큼 띄운다
    const H = this.container.clientHeight || 1, cam = this.camera;
    const f = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const v of this.vis.values()) {
      if (!v.labelOn) continue;
      const d = Math.max(0.01, v.group.position.distanceTo(cam.position));
      const px = (v.mesh.scale.x * f) / d;
      const gap = Math.round(Math.min(90, px * 1.25 + 4));
      if (v._gap !== gap) { v.labelEl.style.marginTop = gap + 'px'; v._gap = gap; }
    }
  }

  _preRender(now, dt) {
    this.chips.update(now);
    const camDist = this.focusDist || this.camera.position.length();
    // 시선 대상 ≈ 카메라 앞 focusDist 지점(격자 페이드 중심)
    const ctl = this._ctl || (this._ctl = this.camera.position.clone());
    this.camera.getWorldDirection(ctl); ctl.multiplyScalar(camDist).add(this.camera.position);
    this.backdrop.update(now, dt, ctl, camDist);
    this.bubbles.update(now, this.camera, this.container.clientHeight || 1);
    if (this.art) this.art.update(now);
  }

  dispose() {
    if (this._disposed) return;
    if (this.labelContainer) this.labelContainer.classList.remove('flow-mode');
    for (const k of ['chips', 'beams', 'backdrop', 'bubbles', 'art']) { if (this[k]) { this[k].dispose(); this[k] = null; } }
    super.dispose();
  }
}
