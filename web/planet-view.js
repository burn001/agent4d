// Planet 3D 표현 — SceneView 바탕 + 행성 연출(메인 = 기계 행성, 서브에이전트 = 대기·구름·위성) + 작업 대상 층.
// 행성 연출은 PlanetDeco(planet-deco.js)가 노드마다 덧붙이고, 흐름(FlowView)은 SceneView 를 따로 상속하므로 영향이 없다.
import { SceneView, escapeHtml } from './scene.js';
import { PlanetArt3D } from './art-layer3d.js';
import { PlanetDeco } from './planet-deco.js';
import { bodyK, JOB_BODY_K } from './planet-core.mjs';
import { isJob, isProc, procJobId, procState, jobOf, isAutoJob, jobLaneValues, fmtRate, heatLevel } from './job-core.mjs'; // 작업 노드 = 작은 탐사선
import { PROC, superviseLine, procName, bigNum } from './planet-proc-core.mjs'; // 분리 프로세스 연출
import { t as tr } from './i18n.mjs';
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
    this._preRender = (now, dt) => { if (this.deco) this.deco.update(now, dt || 0.016); if (this.pArt) this.pArt.update(now); this._supPass(now); };
    // 분리 프로세스·계기 툴팁(앱 공용 툴팁은 도구 패널·사용자 콘솔 전용 — Planet 만의 것을 따로 띄운다)
    this._procTipEl = null;
    this._onProcMove = (e) => this._procTip(e);
    this._onProcLeave = () => this._procTip(null);
    this.renderer.domElement.addEventListener('pointermove', this._onProcMove);
    this.renderer.domElement.addEventListener('pointerleave', this._onProcLeave);
    this._supSet = new Set(); this._supAt = 0;
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
    v.r *= isProc(v.node) ? PROC.BODY_K : isJob(v.node) ? JOB_BODY_K : bodyK(v.kind, !!v.device); // 작업은 백그라운드 명령 위성보다 작게 · 분리 프로세스는 조금 크게
    const r = v.r;
    if (v.kind === 'bash-bg' || v.kind === 'monitor') v.label.position.set(0, -r * 1.2 - 0.4, 0);
    else v.label.position.set(0, r * 1.2 + 0.5, 0);
    v.mesh.scale.setScalar(r);
  }
  /** 작업 노드: scene 기본 색칠(종류 색·상태 흐림) 뒤에 표시 상태 색(렌더러 시계)으로 덮는다 — PlanetDeco.jobStyle */
  _styleVis(v) { super._styleVis(v); if (this.deco && isJob(v.node)) this.deco.jobStyle(v); if (this.deco && this.deco.proc && (isProc(v.node) || isAutoJob(v.node))) this.deco.proc.style(v); }
  // ---- 분리 프로세스: 들여다보기(watch) 이벤트·meta.proc 갱신을 장부로, 감독 줄·툴팁 ----
  flowEvent(ev, opts = {}) { super.flowEvent(ev, opts); if (ev.type === 'watch' && this.deco && this.deco.proc) { this.deco.proc.event(ev); const v = this.vis.get(ev.nodeId); if (v) this._labelText(v); } }
  updateNode(id, patch = {}, opts = {}) {
    super.updateNode(id, patch, opts);
    const v = this.vis.get(id);
    if (v && patch.meta && patch.meta.proc && this.deco && this.deco.proc) this.deco.proc.nodeChanged(v.node);
  }
  reset() { super.reset(); if (this.deco && this.deco.proc) this.deco.proc.clear(); }
  /** 노드 라벨 셋째 줄: 분리 프로세스를 들여다보는 중이면(또는 도구 없이 띄운 프로세스가 돌면) `감독 · probe_branches.py · 48,000 바퀴` */
  _actHtml(v) {
    const pid = this._supOf(v);
    if (pid) {
      const pv = this.vis.get(pid), jv = pv && this.vis.get(procJobId(pv.node));
      const [head, ...rest] = superviseLine(pv.node, jv ? jobOf(jv.node) : null, this.clock()).split(' · ');
      return `<span class="act sup" style="--hc:var(--skill)"><i>${escapeHtml(head)}</i>${rest.length ? ' · ' + escapeHtml(rest.join(' · ')) : ''}</span>`;
    }
    return super._actHtml(v);
  }
  /** v 가 감독하는 분리 프로세스 id: 열린 들여다보기 → 없고 열린 도구도 없으면 끝나지 않은 자식 프로세스 */
  _supOf(v) {
    const fx = this.deco && this.deco.proc;
    if (!fx || !fx.rigs.size) return null;
    const w = fx.supervising(v.id, this.clock());
    if (w && this.vis.has(w)) return w;
    if (v.icons && v.icons.size) return null;
    for (const cid of this.childrenOf.get(v.id) || []) { const cv = this.vis.get(cid); if (cv && isProc(cv.node) && !cv.hidden && (procState(cv.node) === 'running' || procState(cv.node) === 'stale')) return cid; }
    return null;
  }
  /** 감독 줄 숫자가 오르도록 0.5초마다 해당 노드 라벨만 다시(내용이 같으면 DOM 은 그대로) */
  _supPass(now) {
    const fx = this.deco && this.deco.proc;
    if (!fx || now - this._supAt < 0.5) return;
    this._supAt = now;
    const cur = new Set();
    if (fx.rigs.size) for (const r of fx.rigs.values()) { const p = r.v.node.parentId; if (p) cur.add(p); }
    if (fx.rigs.size) for (const p of fx.watch.pulses(this.clock())) if (p.open) cur.add(p.from);
    for (const id of cur) { const v = this.vis.get(id); if (v) this._labelText(v); }
    for (const id of this._supSet) if (!cur.has(id)) { const v = this.vis.get(id); if (v) this._labelText(v); }
    this._supSet = cur;
  }
  /** 계기 판도 집기 대상(누르면 그 작업 노드 카드 — 공용 인스펙터) */
  pick(clientX, clientY) {
    const id = super.pick(clientX, clientY);
    if (id || !this.deco || !this.deco.proc || !this.deco.proc.meters.size) return id;
    const r = this.renderer.domElement.getBoundingClientRect();
    const mid = this.deco.proc.pickMeter(clientX - r.left, clientY - r.top);
    const mv = mid && this.vis.get(mid);
    return mv && !this._scopeOff(mv) && !mv.projOut ? mid : null;
  }
  /** 툴팁: 분리 프로세스·계기 위에 마우스 → `분리 실행 · probe_branches.py` + 레인 값·처리율·과열 */
  _procTip(e) {
    const el = this._procTipEl;
    const hide = () => { if (el && !el.hidden) el.hidden = true; };
    if (!e || !this.deco || !this.deco.proc || (!this.deco.proc.rigs.size && !this.deco.proc.meters.size)) return hide();
    const id = this.pick(e.clientX, e.clientY);
    const v = id && this.vis.get(id);
    if (!v) return hide();
    let pv = null, jv = null;
    if (isProc(v.node)) { pv = v; jv = this.vis.get(procJobId(v.node)); }
    else if (isAutoJob(v.node)) { jv = v; pv = this.vis.get(v.node.parentId) || null; if (pv && !isProc(pv.node)) pv = null; }
    if (!pv && !jv) return hide();
    const tipEl = this._procTipEl || (this._procTipEl = Object.assign(document.createElement('div'), { className: 'holo-tip' }));
    if (!tipEl.isConnected) { tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    const now = this.clock(), job = jv ? jobOf(jv.node) : null;
    const lanes = job ? jobLaneValues(job, now).slice(0, 4).map((l) => `${l.key} ${bigNum(l.value)}${l.unit ? ' ' + l.unit : ''}${l.rate ? ' · ' + fmtRate(l.rate) : ''}`) : [];
    const heat = job ? tr('cards.heat.' + heatLevel(Number(job.heat) || 0)) : '';
    tipEl.textContent = '';
    const b = document.createElement('b'); b.textContent = pv ? `${tr('cards.proc.kind')} · ${procName(pv.node)}` : (jv.node.label || '');
    const sp = document.createElement('span'); sp.textContent = lanes.length ? lanes.join(' / ') + (heat ? ' · ' + heat : '') : (pv ? (pv.node.meta && pv.node.meta.title) || '' : '');
    const sm = document.createElement('small'); sm.textContent = tr('scene.holo.tipHint');
    tipEl.append(b, sp, sm);
    tipEl.style.setProperty('--hc', 'var(--skill)');
    tipEl.hidden = false;
    tipEl.style.left = Math.min(window.innerWidth - 20, e.clientX + 14) + 'px'; tipEl.style.top = Math.min(window.innerHeight - 40, e.clientY + 16) + 'px';
  }
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
  dispose() { if (this.renderer) { this.renderer.domElement.removeEventListener('pointermove', this._onProcMove); this.renderer.domElement.removeEventListener('pointerleave', this._onProcLeave); } if (this._procTipEl) this._procTipEl.remove(); if (this.deco) { this.deco.dispose(); this.deco = null; } if (this.pArt) { this.pArt.dispose(); this.pArt = null; } super.dispose(); }
}
