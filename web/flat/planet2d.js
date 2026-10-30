// Planet 2D(저사양). 3D Planet(scene.js, 예전 '단순 도형') 의 모습을 Canvas 2D 한 장으로:
// 종류별 도형 실루엣(메인 = 기계 행성·서브에이전트 = 구름 띠·위성 행성 — planet-deco2d.js, 워크플로 도넛 = 기운 고리,
// 워크플로 에이전트 팔면체 = 마름모, claude -p 상자 = 모서리 선 사각, 백그라운드 명령 원기둥 = 납작한 원통, 모니터 원뿔 = 삼각),
// 관계선 = 레이저 통신 링크 ⇄ 궤도 공명 고리(planet-links2d.js — 상태 박자, 추정 연결 점선, 퇴장 때 자식 끝부터 감김),
// 흐름 패킷(호출·결과, 궤도계 바깥 끝 사이), 라벨 위(백그라운드 명령·모니터는 아래), 상태색(완료 회색·중지됨 회색·오류 고리 깜빡임),
// 배치 장치 = 낮고 넓은 상자 + 앞면 표시창(진행)·표시등·상태 띠 5칸. 섬·도구 카드·퇴장(흐려짐·축소)·라벨은 바탕(FlatView)·공용(flat-draw.js).
// 생략: 3D 조명·안개·퇴장 입자·기상·바닥 그리드(배경은 단색).
import { FlatView, NODE_SCALE } from './flat-view.js';
import { PlanetArt2D } from './art-layer2d.js'; // 작업 대상 층(켤 때만 만든다)
import { RADIUS } from '../layout.js';
import { paletteOf } from '../flowview/flow-style.mjs';
import { FLOW, PacketPool, planFlow, easeInOut } from '../flow-core.mjs';
import { BATCH, isLauncher } from '../batch-core.mjs';

import { toScreen, camScale, planetShape, planetColor, mixColor } from './flat-core.mjs';
import { drawCards, drawRings, drawDeviceFace, drawIslands } from './flat-draw.js';
import { drawPlanetIslands } from './planet-islands2d.js'; // 섬 = 원형 궤도계
import { drawMechPlanet, drawSubPlanet, drawTourb2D } from './planet-deco2d.js';
import { drawVariant2D, drawVariantCore } from './planet-variants2d.js'; // 서브·claude -p 시안 궤도계 // 행성 연출 · 뚜르비용
import { TOURB_GEO } from '../tourbillon-core.mjs'; // 코어 축소 몫
import { stepOrbits, drawOrbits, drawBursts, emitTool, nearestSat, orbitExtent, ELEV } from './planet-orbits2d.js'; // 궤도계
import { bodyK, VARIANT_CORE } from '../planet-core.mjs';
import { runVis, runVisStatus } from '../run-core.mjs'; // 실행 중 셸
import { FLAT, JOB2D } from './flat-core.mjs';
import { isJobVis, drawJobMoon, jobLevel, drawJobTracks } from './job2d.js'; // 작업 = 주인 둘레 작은 위성 · 항로
import { ProcFlat, isProc, isAutoJob } from './planet-proc2d.js'; // 분리 프로세스 = 채굴 드릴 플랫폼 · 계기 · 컨베이어 · 들여다보기
import { PROC, superviseLine, isExtRig } from '../planet-proc-core.mjs'; // 외부 작업 = 플랫폼 승격
import { procJobId, procState, jobOf } from '../job-core.mjs';
import { cycleProgress } from '../batch-core.mjs'; // G3 회차 고리
import { escapeHtml } from '../html-util.mjs';
import { drawPlanetLinks2D, packetPoint2D } from './planet-links2d.js'; // 관계선: 레이저 ⇄ 궤도 고리
import { plinksMix } from '../plinks-core.mjs';
import { Heat2D } from './planet-heat2d.js'; // 에이전트 과열(글로우·균열·연기)

const TOP_ACTIVE = 6;
const ENDED_OK = (st) => st === 'done' || st === 'stopped';

export class Planet2DView extends FlatView {
  static modeId = 'planet';
  static modeLabel = 'Planet';

  constructor(container, labelContainer, opts = {}) {
    super(container, labelContainer, opts);
    // Planet 은 단일 세션 간격 1배·크기 0.68배(NODE_SCALE)·라벨 위·먼 노드 라벨은 이름만(compactPx 14)
    this.layoutSpread = 1;
    this.overviewSpread = 1;      // Planet 3D 와 같음
    this.labelBelow = false;
    this.compactPx = 14;
    this.labelContainer.classList.remove('flow-mode'); // Flow 라벨 꾸밈(기울임 부제 등) 대신 Planet 라벨(theme.css 기본)
    this.pool = new PacketPool(FLOW.MAX_PACKETS, FLOW.PER_NODE);
    this.flowState = { lastUp: new Map(), lastOut: new Map() };
    this._topActive = new Set();
    this.proc2d = new ProcFlat(this);
    this._supSet = new Set(); this._supAt = 0;
    this.heat2d = new Heat2D(this);
    this.applyTheme();
  }

  /** 노드 그린 반지름(세계): scene.js 와 같음 — RADIUS × 0.68, 배치 장치는 2배, 본체 축소 bodyK(둘레는 궤도계) */
  _nodeR(node, kind) {
    const dev = isLauncher(node);
    const rig = isProc(node) || isExtRig(node); // 분리 프로세스 · 외부 작업 플랫폼은 조금 크게
    const r = RADIUS[kind] * NODE_SCALE * (dev ? 2 * BATCH.DEVICE_K : 1) * (rig ? PROC.BODY_K : bodyK(kind, dev));
    return node && node.meta && node.meta.job && !rig ? r * JOB2D.PLANET_R_K : r; // 작업 = 아주 작은 위성
  }
  /** 라벨 거리: scene.js CSS2D 라벨 자리(반지름 × 1.2 + 0.5, 아래 붙는 종류는 + 0.4) */
  _labelGap(v, s, k) {
    // 가까이(본체 11px 이상 — 궤도계가 다 보이는 크기)면 라벨 뒤 배경색 옅은 번짐(.pl-halo, 3D 와 같은 규칙)
    const near = v.r * k * s >= 11;
    if (near !== !!v._plNear && v.labelEl) { v._plNear = near; v.labelEl.classList.toggle('pl-halo', near); }
    return Math.min(90, (v.r * k * 1.2 + (this.labelUp(v) ? 0.5 : 0.4)) * s + 2);
  }

  applyTheme() {
    super.applyTheme();
    this.P = paletteOf(this.tokens.isLight);
    this._slit = null;
    for (const v of this.vis.values()) v._col = null;
  }
  _styleVis(v) { super._styleVis(v); v._col = null; }
  _colorOf(v) {
    const rs = !!(v.node.meta && v.node.meta.run) && runVis(v.node, this.clock()) === 'stale'; // 실행 중 셸 정체
    const key = v.node.status + (rs ? '!' : '');
    if (v._col && v._colSt === key) return v._col;
    v._colSt = key;
    // 같은 프로젝트 live 메인 여럿이면 메인은 그 세션 색
    const c = planetColor(v.sessC && v.kind === 'main' && !v.node.parentId ? v.sessC : this.kindColor(v.kind), v.node.status, this.tokens);
    return (v._col = rs ? mixColor(c, this.P.jobStale, 0.65) : c);
  }

  // ---------- 흐름 패킷(flow.js FlowLayer 의 2D판: 직선 위 머리 + 잔광 2) ----------
  flowEvent(ev, opts = {}) {
    super.flowEvent(ev, opts);
    if (ev.type === 'watch' && this.proc2d) { this.proc2d.event(ev); const wv = this.vis.get(ev.nodeId); if (wv) this._labelText(wv); }
    const now = performance.now() / 1000, speed = opts.speed || 1;
    const plans = planFlow(ev, {
      has: (id) => { const v = this.vis.get(id); return !!v && !v.hidden; },
      parentOf: (id) => { const v = this.vis.get(id); return v ? v.node.parentId : null; },
      activeChild: (id) => {
        const kids = this.children(id);
        for (let i = kids.length - 1; i >= 0; i--) { const cv = this.vis.get(kids[i]); if (cv && !cv.hidden && cv.node.status === 'active') return cv.id; }
        return null;
      },
      now, speed, state: this.flowState,
    });
    const dur = FLOW.LINK_DUR / Math.min(2, Math.max(1, Math.sqrt(speed)));
    for (const pl of plans) {
      if (pl.kind !== 'link') continue;
      const s = this.pool.alloc(pl.from, now);
      s.kind = pl.kind; s.from = pl.from; s.to = pl.to; s.color = pl.color; s.size = pl.size || 1; s.dur = dur; s.up = pl.dir === 'up';
    }
  }
  // ---- 분리 프로세스: meta.proc 의 열린 들여다보기 맞추기 · 감독 줄 · 계기 집기 ----
  addNode(node, spawn = true) { super.addNode(node, spawn); if (this.proc2d) this.proc2d.node(node); }
  updateNode(id, patch = {}, opts = {}) { super.updateNode(id, patch, opts); const v = this.vis.get(id); if (v && patch.meta && patch.meta.proc && this.proc2d) this.proc2d.node(v.node); }
  _actHtml(v) {
    const pid = this._supOf(v);
    if (pid) {
      const pv = this.vis.get(pid), jv = pv && this.vis.get(procJobId(pv.node));
      const [head, ...rest] = superviseLine(pv.node, jv ? jobOf(jv.node) : null, this.clock()).split(' · ');
      return `<span class="act sup" style="--hc:var(--skill)"><i>${escapeHtml(head)}</i>${rest.length ? ' · ' + escapeHtml(rest.join(' · ')) : ''}</span>`;
    }
    return super._actHtml(v);
  }
  _supOf(v) {
    if (!this.proc2d || !this.proc2d.any) return null;
    const w = this.proc2d.supervising(v.id);
    if (w && this.vis.has(w)) return w;
    if (v.icons && v.icons.size) return null;
    for (const cid of this.childrenOf.get(v.id) || []) { const cv = this.vis.get(cid); if (cv && isProc(cv.node) && !cv.hidden && (procState(cv.node) === 'running' || procState(cv.node) === 'stale')) return cid; }
    return null;
  }
  pick(clientX, clientY) {
    const id = super.pick(clientX, clientY);
    if (id || !this.proc2d || !this.proc2d.meters.size) return id;
    const r = this.canvas.getBoundingClientRect();
    return this.proc2d.pickMeter(clientX - r.left, clientY - r.top);
  }
  reset() { super.reset(); if (this.heat2d) this.heat2d.clear(); if (this.proc2d) this.proc2d.clear(); if (this.pool) { this.pool.clear(); this.flowState.lastUp.clear(); this.flowState.lastOut.clear(); } }

  _labelPass(now) {
    super._labelPass(now);
    const act = [];
    for (const v of this.vis.values()) if (v.node.status === 'active' && !v.hidden) act.push(v);
    act.sort((a, b) => (b.node.lastActivityAt || '').localeCompare(a.node.lastActivityAt || ''));
    this._topActive = new Set(act.slice(0, TOP_ACTIVE).map((v) => v.id));
  }

  /** 패킷이 날면 30fps, 작업 중 연결선의 흐르는 점·회전·맥동은 배경 움직임(15fps, 바탕이 active 노드로 1 을 줌) */
  // ---- 작업 대상 층(섬 바닥 = 행성 표면). 끄면 객체가 없고 그리기·맞춤에 아무것도 더하지 않는다 ----
  setArtifacts({ on, book, fx, style } = {}) {
    if (on && !this.pArt && book && fx) this.pArt = new PlanetArt2D(this, { book, fx, style });
    else if (!on && this.pArt) { this.pArt.dispose(); this.pArt = null; }
    this.invalidate();
    return !!this.pArt;
  }
  get artOn() { return !!this.pArt; }
  pickArtifact(clientX, clientY) { if (!this.pArt) return null; const r = this.canvas.getBoundingClientRect(); return this.pArt.pick(clientX - r.left, clientY - r.top); }
  artPos(pid, id) { return this.pArt ? this.pArt.posOf(pid, id) : null; }
  setArtFoot(pid, nodeId) { if (this.pArt) { this.pArt.st.setFoot(pid, nodeId); this.invalidate(); } }
  setArtSelected(t) { if (this.pArt) { this.pArt.st.sel = t || null; this.invalidate(); } }
  fitExtra(pts, scope) { if (this.pArt) this.pArt.fitPoints(pts, scope); }
  /** 전체 맞춤이 담는 노드 겉 반지름: 궤도계 바깥(카드 기준점과 같은 식) */
  fitNodeR(id) { const v = this.vis.get(id); if (!v) return 1; return v.r * (v._po ? Math.max(1, Math.min(orbitExtent(v), 3.4) * 0.9) : 1); }

  _updateExtra(now, dt = 0) {
    // 도구 입자가 날면 30fps. 일하는 노드가 없어도 궤도가 아주 느리게 돌도록 쉬는 동안 약 7fps 로 다시 그림(_schedule)
    this._idleOrbit = !this.reduced && !this._frozen && this.vis.size > 0;
    if (this._idleOrbit) this.dirty = true;
    const jl = Math.max(jobLevel(this, now), this.proc2d ? this.proc2d.level() : 0); // 작업 표시 상태(시계) — 진행·정체 15fps · 분리 프로세스
    if (this.proc2d && this.proc2d.any && now - this._supAt >= 0.5) { // 감독 줄 숫자가 오르게 0.5초마다 띄운 노드 라벨만 다시
      this._supAt = now;
      const cur = new Set();
      for (const v of this.vis.values()) if (v.node && isProc(v.node) && v.node.parentId) cur.add(v.node.parentId);
      for (const id of new Set([...cur, ...this._supSet])) { const v = this.vis.get(id); if (v) this._labelText(v); }
      this._supSet = cur;
    }
    const hl = this.heat2d ? this.heat2d.step(now, dt) : 0; // 과열: 연기가 움직이거나 식는 동안 15fps
    if (this._pb && this._pb.length) return 2;
    let level = Math.max(jl, hl, this.pool.active.length || (this._plMix && this._plMix.fading) ? 2 : 0); // 관계선 전환 페이드 동안 30fps
    if (this.pArt) level = Math.max(level, this.pArt.level(now));
    if (this.scope.mode === 'all' && !this.reduced) for (const c of this._clusterV.values()) if (c.busy) { level = Math.max(level, 1); break; }
    return level;
  }

  // ---------- 그리기 ----------
  /** 쉬는 동안(level 0)의 4Hz 논리 갱신을 궤도용 약 7fps 로 — 그리기는 매번(dirty) */
  _schedule(ms) { super._schedule(this._idleOrbit && ms === FLAT.IDLE_MS ? 140 : ms); }
  /** 카드 기준점: 궤도계 바깥(본체 × extent), 투사 빔은 가장 가까운 위성에서, 스캔라인 */
  _cardAnchor(v) {
    const ext = v._po ? Math.min(orbitExtent(v), 3.4) * 0.9 : 1;
    return { x: v._sp.x, y: v._sp.y, R: v._R * Math.max(1, ext), proj: (cx, cy) => nearestSat(v, cx, cy), scan: true };
  }

  _drawScene(ctx, now) {
    const W = this.W, H = this.H, t = this.tokens;
    this._pbNow = now;
    this._font = null; ctx.font = '10px sans-serif';
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    const s = this._s = camScale(this.cam, H);
    if (this.scope.mode === 'all') drawPlanetIslands(this, ctx, now, s); // 원형 궤도계
    if (this.pArt) this.pArt.draw(ctx, now); // 바닥층(노드·연결 아래)
    for (const v of this.vis.values()) {
      if (v.gone || v.hidden) { v._on = false; continue; }
      const p = toScreen(this.cam, W, H, v.pos.x, v.pos.z, v._sp || (v._sp = {}));
      const R = v.r * (v.drawS || 1) * s;
      v._R = R;
      v._on = p.x > -R - 300 && p.x < W + R + 300 && p.y > -R - 300 && p.y < H + R + 300;
    }
    // 관계선(띄움 포함): 레이저 통신 링크 ⇄ 궤도 공명 고리, 3D 와 같은 시계
    this._plMix = plinksMix(this.pool.active.length > 0, this.reduced);
    drawPlanetLinks2D(this, ctx, now, s, this._plMix);
    // 안 A 항로(노드 아래 층) — 분리 프로세스 아래 계기는 그대로
    drawJobTracks(this, ctx, now, s, (ov) => (ov._po ? Math.min(orbitExtent(ov), 3.4) * ov._R : ov._R || 0), (v) => { const pv = this.vis.get(v.node.parentId); return !!(pv && isProc(pv.node)); });
    this.proc2d.step(now); this.proc2d.beginFrame(); this.proc2d.drawFlows(ctx, now, s); // 컨베이어·광석·화물·들여다보기
    this._drawPackets(ctx, now, s);
    this.sess.drawUnder(ctx, now); // 충돌 곡선·세션 간 메시지
    // 큰 것(메인·장치)이 아래로 깔리지 않게 작은 것부터가 아니라 들어온 순서대로 — 3D 도 깊이로만 가림
    for (const v of this.vis.values()) if (v._on) this._drawNode(ctx, v, now);
    drawBursts(this, ctx, now); // 도구 입자
    drawRings(this, ctx, now, s);
    drawCards(this, ctx, now, s, this._cardAnchorFn || (this._cardAnchorFn = (v) => this._cardAnchor(v)));
    this.sess.drawOver(ctx, now); // 파일명 칩
  }

  _pktColor(c) {
    const P = this.P;
    return c === 'call' ? P.dispatch : c === 'ok' ? P.ret : c === 'error' ? P.error : c === 'stopped' ? P.stopped : c === 'output' ? P.output : P.text;
  }
  _drawPackets(ctx, now, s) {
    const dead = [];
    const pa = {}, pb = {};
    for (const k of this.pool.active) {
      const fv = this.vis.get(k.from), tv = this.vis.get(k.to);
      if (!fv || !tv || fv.hidden || tv.hidden) { dead.push(k); continue; }
      const u = (now - k.t0) / k.dur;
      if (u >= 1) { dead.push(k); continue; }
      const e = easeInOut(Math.max(0, u));
      toScreen(this.cam, this.W, this.H, fv.pos.x, fv.pos.z, pa);
      toScreen(this.cam, this.W, this.H, tv.pos.x, tv.pos.z, pb);
      ctx.fillStyle = this._pktColor(k.color);
      const r = Math.max(1.6, Math.min(6, 0.4 * k.size * s));
      const w = this._plMix ? this._plMix.w : 0, q = this._pq || (this._pq = {});
      for (let i = 2; i >= 0; i--) {
        const uu = Math.max(0, e - i * 0.06);
        ctx.globalAlpha = i === 0 ? (u > 0.88 ? (1 - u) / 0.12 * 0.6 + 0.4 : 1) : 0.45 / i;
        packetPoint2D(fv, tv, pa, pb, uu, k.up, w, q); // 궤도계 바깥 끝 · 레이저 직선 / 궤도 짧은 곡선
        ctx.beginPath(); ctx.arc(q.x, q.y, i === 0 ? r : r * (1 - i * 0.25), 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const k of dead) this.pool.release(k);
    ctx.globalAlpha = 1;
  }

  /** 연기 꼬리 방향: 부모 → 이 노드 화면 방향(단위), 부모가 없으면 null(오른쪽 위) */
  _heatAway(v) {
    const pv = v.node.parentId && this.vis.get(v.node.parentId);
    if (!pv || !pv._sp || !v._sp) return null;
    const dx = v._sp.x - pv._sp.x, dy = v._sp.y - pv._sp.y, l = Math.hypot(dx, dy);
    if (l < 1e-3) return null;
    const o = this._hAw || (this._hAw = {}); o.x = dx / l; o.y = dy / l; return o;
  }
  /** 도구 입자가 향할 화면 점: 부모(연결선 쪽), 루트면 도구를 쓰는 자식, 없으면 null(바깥으로) */
  _emitTarget(v) {
    const pv = v.node.parentId && this.vis.get(v.node.parentId);
    if (pv && !pv.hidden && pv._sp) return pv._sp;
    for (const id of this.children(v.id)) { const cv = this.vis.get(id); if (cv && !cv.hidden && cv._on && cv.node.status === 'active') return cv._sp; }
    return null;
  }

  /**
   * G3 기동기 회차 고리(3D DeckRing 과 같은 규칙 — 납작한 타원 위 최근 회차 칸 + 안쪽 이번 회차 진행 호) · G4 Monitor 재무장 눈금(12칸 중 rearmCount)
   */
  _deckRing(ctx, v, x, y, R, alpha, now) {
    if (R < 4) return;
    const t = this.tokens, P = this.P, SE = Math.sin(ELEV), TOP = -Math.PI / 2;
    if (v.device) {
      const info = v.devInfo; if (!info) return;
      const band = info.band || [], n = Math.max(1, band.length), rx = R * 1.8, rot = this.reduced ? 0 : (now * 0.075) % (Math.PI * 2);
      ctx.lineWidth = Math.max(2, R * 0.16);
      for (let i = 0; i < n; i++) {
        const b = band[i] | 0, a0 = TOP + rot + (i / n) * Math.PI * 2 + 0.06, a1 = TOP + rot + ((i + 1) / n) * Math.PI * 2 - 0.06;
        ctx.globalAlpha = alpha * (band.length ? (b ? 0.85 : 0.25) : 0.15);
        ctx.strokeStyle = b === 1 ? P.tool : b === 2 ? P.done : b === 3 ? P.stopped : b === 4 ? P.error : P.textDim;
        ctx.beginPath(); ctx.ellipse(x, y, rx, rx * SE, 0, a0, a1); ctx.stroke();
      }
      const cur = info.running > 0 && info.currentId ? this.vis.get(info.currentId) : null;
      const pr = cur ? cycleProgress(info, cur.node, this.clock()) : null;
      if (info.running > 0) {
        const ri = R * 1.55; ctx.lineWidth = Math.max(1.2, R * 0.07); ctx.strokeStyle = P.tool;
        ctx.globalAlpha = alpha * 0.18; ctx.beginPath(); ctx.ellipse(x, y, ri, ri * SE, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = alpha * 0.95; ctx.beginPath();
        if (pr != null) ctx.ellipse(x, y, ri, ri * SE, 0, TOP, TOP + Math.max(0.02, pr) * Math.PI * 2);
        else { const h = this.reduced ? TOP : now * 2.2; ctx.ellipse(x, y, ri, ri * SE, 0, h, h + 1.1); }
        ctx.stroke();
      }
    } else {
      const m = v.node.meta || {}, cnt = Math.min(12, Number(m.rearmCount) || (m.rearmOf ? 1 : 0));
      if (!cnt) return;
      const rx = R * 2.1, c = this._colorOf(v);
      ctx.lineWidth = Math.max(1.5, R * 0.1); ctx.strokeStyle = c;
      for (let k = 0; k < 12; k++) {
        const a = TOP + (k / 12) * Math.PI * 2;
        ctx.globalAlpha = alpha * (k < cnt ? 0.9 : 0.15);
        ctx.beginPath(); ctx.ellipse(x, y, rx, rx * SE, 0, a - 0.11, a + 0.11); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawNode(ctx, v, now) {
    const t = this.tokens, L = t.isLight;
    const st = v.node.meta && v.node.meta.run ? runVisStatus(v.node, this.clock()) : v.node.status; // 오래 도는 셸 = 작업 중 맥동(정체는 멈춤)
    const active = st === 'active' && !v.scopeRecent;
    const pulse = active && !this.reduced ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (now + v.seed)) / 1.2) : 0;
    const R = v._R * (1 + 0.08 * pulse);
    const { x, y } = v._sp;
    if (isProc(v.node) || isExtRig(v.node)) { // 분리 프로세스 = 채굴 드릴 플랫폼 · 외부 작업도(계기는 데릭 위)
      const a = (v.baseOpacity ?? 1) * (v.exitF ?? 1);
      if (a < 0.01) return;
      this.proc2d.drawRig(ctx, v, x, y, v._R, a, now, this._colorOf(v));
      if (isExtRig(v.node)) this.proc2d.drawMeter(ctx, v, x, y, v._R, a * (v.scopeK ?? 1) * (v.projA ?? 1), now, this._s, { rig: true });
      if (v.id === this.focusId || v.id === this.hoverId) { ctx.globalAlpha = 0.85; ctx.strokeStyle = t.text; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y - v._R * 0.6, v._R * 1.6 + 2, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      return;
    }
    if (isAutoJob(v.node)) { this.proc2d.drawMeter(ctx, v, x, y, v._R, (v.scopeK ?? 1) * (v.exitF ?? 1) * (v.projA ?? 1), now, this._s); return; } // 계기 판
    if (isJobVis(v)) { drawJobMoon(this, ctx, v, x, y, v._R, (v.scopeK ?? 1) * (v.exitF ?? 1), now, this.vis.get(this.parentOf.get(v.id) || v.node.parentId)); return; }
    const alpha = (v.baseOpacity ?? 1) * (v.exitF ?? 1);
    if (alpha < 0.01) return;
    const col = this._colorOf(v);
    if (R < 1.6) { // 아주 작은 점: 과열이면 후광 원만 먼저(멀리서 읽히는 신호)
      if ((v._ht || 0) > 0.002) this.heat2d.drawUnder(ctx, v, x, y, Math.max(1.2, R), alpha, now);
      ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.globalAlpha = 1; return;
    }
    const foc = v.id === this.focusId || v.id === this.hoverId;
    // 밝기(3D 발광): 작업 중 밝게·맥동, 대기 보통, 완료 어둡게 — 2D 는 테두리 밝기로
    if (v._edgeK !== col + st + L) { // 색 문자열은 상태·테마가 바뀔 때만 다시 만든다
      v._edgeK = col + st + L;
      const glowK = st === 'active' ? 1 : st === 'idle' ? 0.45 : st === 'error' ? 0.6 : 0.25;
      v._edge = L ? mixColor(col, '#000000', 0.28) : mixColor(col, '#ffffff', 0.18 + 0.3 * glowK);
      v._cylTop = mixColor(col, '#ffffff', L ? 0.3 : 0.15);
    }
    const edge = v._edge;
    const shape = planetShape(v.kind, v.device);
    const rot = this.reduced ? 0 : now * (st === 'active' ? 0.35 : 0.08) + v.seed;
    // 궤도계 뒤 반쪽(몸체 전) — 서브 유형의 뒤 부품(고리 뒤·혜성 꼬리·짝 몸체 뒤)도
    const po = stepOrbits(this, v, now);
    const vn = po && po.spec.variant;
    // 과열: 몸체 반지름(시안 = 작은 본체, 메인 = 뚜르비용까지) — 글로우는 몸체 전, 테두리·균열·연기는 맨 앞
    const hot = (v._ht || 0) > 0.002;
    const hRb = hot ? (vn ? Math.max(1.2, R * (VARIANT_CORE[vn] || 0.4)) : shape === 'box' ? R * 0.9 : R) : 0;
    const hRs = vn ? Math.max(hRb, R * 0.55) : hRb;
    if (hot) this.heat2d.drawUnder(ctx, v, x, y, hRb, alpha, now, hRs);
    const colO = hot ? this.heat2d.tintCol(v, col) : col; // 궤도 링·위성·시안 부품 단계색
    if (vn) { // 시안: 뒤쪽 → 작은 본체 → 앞쪽(3D 와 같은 시안·상태)
      drawVariant2D(this, ctx, v, vn, x, y, R, alpha, now, colO, 0);
      drawVariantCore(this, ctx, v, vn, x, y, R, alpha, now, col, edge);
      drawVariant2D(this, ctx, v, vn, x, y, R, alpha, now, colO, 1);
    }
    const sub = shape === 'sphere';
    const oOpt = sub && v._pd && v._pd.type === 'swarm' ? { spread: 1 + 0.32 * (v._pd.toolK || 0) } : undefined; // 위성 군단: 도구 때 산개
    if (!vn) drawOrbits(this, ctx, v, x, y, R, alpha, now, colO, 0, oOpt);
    if (sub && !vn) drawSubPlanet(this, ctx, v, x, y, R, alpha, now, col, edge, 0);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1, R * (foc ? 0.12 : 0.07));
    if (vn) { /* 시안이 본체까지 그렸음 */ } else if (shape === 'ico') {
      // 메인 = 기계 행성: 이음선·코어 광·해치·기어 띠·궤도 링·안테나
      // 무브먼트가 보이는 크기면 몸체를 코어로 줄여(3D uShrink 와 같은 몫) 기어·프레임이 앞에 서게
      drawMechPlanet(this, ctx, v, x, y, R >= 4 ? R * TOURB_GEO.CORE_K * 1.12 : R, alpha, now, col, edge, pulse);
      drawTourb2D(this, ctx, v, x, y, R, alpha, now, true);
    } else if (shape === 'sphere') {
      // 서브에이전트 = 구름 띠·대기·위성
      drawSubPlanet(this, ctx, v, x, y, R, alpha, now, col, edge, 1);
      drawTourb2D(this, ctx, v, x, y, R, alpha, now, false);
    } else if (shape === 'torus') {
      // 워크플로 도넛(기울여 놓고 z 축으로 돎) = 납작한 고리
      ctx.lineWidth = Math.max(1.5, R * 0.36);
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.ellipse(x, y, R, R * 0.42, this.reduced ? 0 : rot * 1.7, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(0.8, R * 0.05); ctx.strokeStyle = edge;
      ctx.beginPath(); ctx.ellipse(x, y, R * 1.18, R * 0.6, this.reduced ? 0 : rot * 1.7, 0, Math.PI * 2); ctx.stroke();
    } else if (shape === 'octa') {
      const sq = Math.cos(rot * 1.4) * 0.35 + 0.65; // 팔면체가 돌며 폭이 변함
      ctx.beginPath(); ctx.moveTo(x, y - R); ctx.lineTo(x + R * sq, y); ctx.lineTo(x, y + R); ctx.lineTo(x - R * sq, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (R > 6) { ctx.globalAlpha = alpha * 0.45; ctx.beginPath(); ctx.moveTo(x, y - R); ctx.lineTo(x, y + R); ctx.moveTo(x - R * sq, y); ctx.lineTo(x + R * sq, y); ctx.stroke(); }
    } else if (shape === 'box') {
      // claude -p 상자 + 밝은 모서리 선(3D EdgesGeometry 1.8배 틀)
      const h = R * 0.72;
      ctx.save(); ctx.translate(x, y); ctx.rotate(this.reduced ? 0 : rot * 0.6);
      ctx.fillRect(-h, -h, 2 * h, 2 * h);
      ctx.globalAlpha = alpha * (ENDED_OK(st) ? 0.3 : 0.95);
      ctx.strokeStyle = st === 'stopped' ? col : this.kindColor(v.kind); ctx.lineWidth = Math.max(1, R * 0.06);
      ctx.strokeRect(-R * 0.9, -R * 0.9, R * 1.8, R * 1.8);
      ctx.restore();
    } else if (shape === 'cyl') {
      // 백그라운드 명령 원기둥(높이 0.55) = 납작한 원통: 몸통 + 윗면 타원
      const h = R * 0.55;
      ctx.beginPath(); ctx.ellipse(x, y + h * 0.5, R, R * 0.42, 0, 0, Math.PI); ctx.lineTo(x - R, y - h * 0.5); ctx.ellipse(x, y - h * 0.5, R, R * 0.42, 0, Math.PI, 0, true); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = v._cylTop;
      ctx.beginPath(); ctx.ellipse(x, y - h * 0.5, R, R * 0.42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (shape === 'cone') {
      // 모니터 원뿔(반지름 0.85·높이 1.7) = 위가 뾰족한 삼각 + 밑면 타원
      const bw = R * 0.85, hh = R * 0.85;
      ctx.beginPath(); ctx.moveTo(x, y - hh); ctx.lineTo(x + bw, y + hh * 0.75); ctx.ellipse(x, y + hh * 0.75, bw, bw * 0.3, 0, 0, Math.PI); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (shape === 'device') {
      // 배치 장치: 낮고 넓은 상자(2.1 × 1.25) 앞면에 표시창(진행)·표시등·상태 띠 5칸
      const w = R * 2.1, h = R * 1.25;
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = alpha; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = this._slit || (this._slit = mixColor(t.bg, t.text, L ? 0.18 : 0.08));
      ctx.fillRect(x - w * 0.44, y - h * 0.4, w * 0.88, h * 0.8);
      drawDeviceFace(this, ctx, v, x, y, w, h, R, alpha, now);
    }
    if (!vn) drawOrbits(this, ctx, v, x, y, R, alpha, now, colO, 1, oOpt); // 궤도계 앞 반쪽
    if (v.device || v.kind === 'monitor') this._deckRing(ctx, v, x, y, R, alpha, now); // G3 회차 고리 · G4 재무장 눈금
    if (hot) this.heat2d.drawOver(ctx, v, x, y, hRb, alpha, now, this._heatAway(v), hRs);
    if (active && v.icons && v.icons.size) emitTool(this, v, R, this._emitTarget(v), col);
    // 오류 고리: 처음 1.8초 깜빡, 10분 지난 오류는 옅게
    if (v.errorSince != null) {
      const e = now - v.errorSince;
      if (e > 1.8 || Math.floor(e / 0.3) % 2 === 0) {
        ctx.globalAlpha = alpha * (v.stale ? 0.3 : 0.95); ctx.strokeStyle = t.error; ctx.lineWidth = Math.max(1.2, R * 0.08);
        ctx.beginPath(); ctx.arc(x, y, v.r * (v.size || 1) * this._s * 1.38, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (foc) { ctx.globalAlpha = 0.85; ctx.strokeStyle = t.text; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, R * (v.device ? 1.4 : 1.32) + 2, 0, Math.PI * 2); ctx.stroke(); }
    // 대기 중 카드 수 +N
    const q = this.holo.book.queued(v.id);
    if (q > 0 && R > 4) {
      ctx.globalAlpha = alpha; ctx.fillStyle = this.P.tool; ctx.font = `600 ${Math.round(Math.max(9, Math.min(12, R * 0.5)))}px sans-serif`; this._font = null;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('+' + q, x + R * 0.9, y + R * 0.6);
    }
    ctx.globalAlpha = 1;
  }
}
