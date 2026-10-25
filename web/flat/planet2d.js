// Planet 2D(저사양). 3D Planet(scene.js, 예전 '단순 도형') 의 모습을 Canvas 2D 한 장으로:
// 종류별 도형 실루엣(메인 = 기계 행성·서브에이전트 = 구름 띠·위성 행성 — planet-deco2d.js, 워크플로 도넛 = 기운 고리,
// 워크플로 에이전트 팔면체 = 마름모, claude -p 상자 = 모서리 선 사각, 백그라운드 명령 원기둥 = 납작한 원통, 모니터 원뿔 = 삼각),
// 직선 연결(완료·오래된 오류 흐림, 오류 빨강, 추정 연결 점선, 퇴장 때 자식 끝부터 감김) + 작업 중 연결선 위 흐르는 점 3개,
// 흐름 패킷(호출·결과, 직선 위), 라벨 위(백그라운드 명령·모니터는 아래), 상태색(완료 회색·중지됨 회색·오류 고리 깜빡임),
// 배치 장치 = 낮고 넓은 상자 + 앞면 표시창(진행)·표시등·상태 띠 5칸. 섬·도구 카드·퇴장(흐려짐·축소)·라벨은 바탕(FlatView)·공용(flat-draw.js).
// 생략: 3D 조명·안개·퇴장 입자·기상·바닥 그리드(배경은 단색).
import { FlatView, NODE_SCALE } from './flat-view.js';
import { PlanetArt2D } from './art-layer2d.js'; // 작업 대상 층(켤 때만 만든다)
import { RADIUS } from '../layout.js';
import { paletteOf } from '../flowview/flow-style.mjs';
import { FLOW, PacketPool, planFlow, easeInOut } from '../flow-core.mjs';
import { isGuessLink, isLauncher } from '../batch-core.mjs';
import { DEG, degOf, degOfLink, packetGone, lineFlicker, brokenDash } from '../degrade-core.mjs';
const DG_DASH = [0, 0, 0, 0]; // 끊긴 선 무늬(재사용)

import { toScreen, camScale, planetShape, planetColor, mixColor, retractPt } from './flat-core.mjs';
import { drawCards, drawRings, drawDeviceFace, drawIslands } from './flat-draw.js';
import { drawMechPlanet, drawSubPlanet } from './planet-deco2d.js'; // 행성 연출
import { stepOrbits, drawOrbits, drawBursts, emitTool, nearestSat, orbitExtent } from './planet-orbits2d.js'; // 궤도계
import { bodyK } from '../planet-core.mjs';
import { FLAT } from './flat-core.mjs';

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
    this.applyTheme();
  }

  /** 노드 그린 반지름(세계): scene.js 와 같음 — RADIUS × 0.68, 배치 장치는 2배, 본체 축소 bodyK(둘레는 궤도계) */
  _nodeR(node, kind) { const dev = isLauncher(node); return RADIUS[kind] * NODE_SCALE * (dev ? 2 : 1) * bodyK(kind, dev); }
  /** 라벨 거리: scene.js CSS2D 라벨 자리(반지름 × 1.2 + 0.5, 아래 붙는 종류는 + 0.4) */
  _labelGap(v, s, k) { return Math.min(90, (v.r * k * 1.2 + (this.labelUp(v) ? 0.5 : 0.4)) * s + 2); }

  applyTheme() {
    super.applyTheme();
    this.P = paletteOf(this.tokens.isLight);
    this._slit = null;
    for (const v of this.vis.values()) v._col = null;
  }
  _styleVis(v) { super._styleVis(v); v._col = null; }
  _colorOf(v) {
    if (v._col && v._colSt === v.node.status) return v._col;
    v._colSt = v.node.status;
    // 같은 프로젝트 live 메인 여럿이면 메인은 그 세션 색
    return (v._col = planetColor(v.sessC && v.kind === 'main' && !v.node.parentId ? v.sessC : this.kindColor(v.kind), v.node.status, this.tokens));
  }

  // ---------- 흐름 패킷(flow.js FlowLayer 의 2D판: 직선 위 머리 + 잔광 2) ----------
  flowEvent(ev, opts = {}) {
    super.flowEvent(ev, opts);
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
      s.kind = pl.kind; s.from = pl.from; s.to = pl.to; s.color = pl.color; s.size = pl.size || 1; s.dur = dur;
    }
  }
  reset() { super.reset(); if (this.pool) { this.pool.clear(); this.flowState.lastUp.clear(); this.flowState.lastOut.clear(); } }

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

  _updateExtra(now) {
    // 도구 입자가 날면 30fps. 일하는 노드가 없어도 궤도가 아주 느리게 돌도록 쉬는 동안 약 7fps 로 다시 그림(_schedule)
    this._idleOrbit = !this.reduced && !this._frozen && this.vis.size > 0;
    if (this._idleOrbit) this.dirty = true;
    if (this._pb && this._pb.length) return 2;
    let level = this.pool.active.length ? 2 : 0;
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
    if (this.scope.mode === 'all') drawIslands(this, ctx, now, s);
    if (this.pArt) this.pArt.draw(ctx, now); // 바닥층(노드·연결 아래)
    for (const v of this.vis.values()) {
      if (v.gone || v.hidden) { v._on = false; continue; }
      const p = toScreen(this.cam, W, H, v.pos.x, v.pos.z, v._sp || (v._sp = {}));
      const R = v.r * (v.drawS || 1) * s;
      v._R = R;
      v._on = p.x > -R - 300 && p.x < W + R + 300 && p.y > -R - 300 && p.y < H + R + 300;
    }
    this._drawSpawnLinks(ctx); // 띄움 점선
    this._drawLinks(ctx, now, s);
    this._drawPackets(ctx, now, s);
    this.sess.drawUnder(ctx, now); // 충돌 곡선·세션 간 메시지
    // 큰 것(메인·장치)이 아래로 깔리지 않게 작은 것부터가 아니라 들어온 순서대로 — 3D 도 깊이로만 가림
    for (const v of this.vis.values()) if (v._on) this._drawNode(ctx, v, now);
    drawBursts(this, ctx, now); // 도구 입자
    drawRings(this, ctx, now, s);
    drawCards(this, ctx, now, s, this._cardAnchorFn || (this._cardAnchorFn = (v) => this._cardAnchor(v)));
    this.sess.drawOver(ctx, now); // 파일명 칩
  }

  /** 직선 연결(scene.js _updateLinks 와 같은 색 규칙) + 작업 중 연결선 위 흐르는 점 3개 */
  _drawLinks(ctx, now, s) {
    const t = this.tokens;
    const dim = this._dimLink || (this._dimLink = {});
    if (dim.key !== t.link + t.bg) { dim.key = t.link + t.bg; dim.c = mixColor(t.link, t.bg, 0.6); }
    const a = {}, b = {}, e = {};
    const lw = Math.max(1, Math.min(2.2, s * 0.06));
    for (const [cv, pv] of this.links) {
      if (cv.gone || pv.gone || cv.hidden || pv.hidden) continue;
      if (!cv._on && !pv._on) continue;
      const st = cv.node.status;
      let col = ENDED_OK(st) || (st === 'error' && cv.stale) ? dim.c : st === 'error' ? t.error : cv.sessC || t.link; // 세션 색
      const sk = cv.scopeK ?? 1;
      const sD = cv.scopeD ?? sk; // 고정 희미(recent)만 바닥 0.2, 프로젝트 페이드는 그대로 곱함
      let al = (sD < 1 ? 0.2 + 0.8 * sD : 1) * (cv.projA ?? 1);
      const exiting = cv.exiting != null;
      if (cv.exitF < 1) al *= exiting ? 1 - 0.65 * (1 - cv.exitF) : cv.exitF;
      if (al < 0.02) continue;
      toScreen(this.cam, this.W, this.H, pv.pos.x, pv.pos.z, a);
      toScreen(this.cam, this.W, this.H, cv.pos.x, cv.pos.z, b);
      const end = cv._linkK > 0 ? retractPt(a, b, cv._linkK, e) : b;
      // 신호 열화: 그 세션 연결선은 끊긴 토막으로 깜빡이고 흐르는 점이 중간에 사라진다
      const dg = DEG.on ? degOf(cv.id) : 0, tt = DEG.reduced ? 0 : DEG.t, sd = dg > 0 ? (cv.seed * 1e6) | 0 : 0;
      ctx.globalAlpha = al * 0.85 * (dg > 0 ? lineFlicker(sd, tt, dg) : 1);
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      const dashed = isGuessLink(cv.node);
      if (dashed) ctx.setLineDash([6, 5]);
      else if (dg > 0) ctx.setLineDash(brokenDash(sd, tt, dg, Math.max(3, s * 0.4), DG_DASH));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      if (dashed || dg > 0) ctx.setLineDash([]);
      // 작업 중 자식으로 가는 연결선: 종류 색 점 3개가 부모 → 자식으로 흐른다
      if (st === 'active' && sk >= 0.5 && !exiting) {
        ctx.globalAlpha = 0.95; ctx.fillStyle = this.kindColor(cv.kind);
        const r = Math.max(1.4, Math.min(3.2, s * 0.09));
        for (let j = 0; j < 3; j++) {
          const u = this.reduced ? (j + 0.5) / 3 : (now * 0.55 + j / 3 + cv.seed) % 1;
          if (dg > 0 && !DEG.reduced && packetGone(sd + j * 7 + Math.floor(now * 0.55 + j / 3 + cv.seed), u, dg)) continue;
          ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
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
      if (DEG.on && !DEG.reduced && packetGone((k.t0 * 1000) | 0, u, degOfLink(k.from, k.to))) continue; // 패킷 중간 소실
      const e = easeInOut(Math.max(0, u));
      toScreen(this.cam, this.W, this.H, fv.pos.x, fv.pos.z, pa);
      toScreen(this.cam, this.W, this.H, tv.pos.x, tv.pos.z, pb);
      ctx.fillStyle = this._pktColor(k.color);
      const r = Math.max(1.6, Math.min(6, 0.4 * k.size * s));
      for (let i = 2; i >= 0; i--) {
        const uu = Math.max(0, e - i * 0.06);
        ctx.globalAlpha = i === 0 ? (u > 0.88 ? (1 - u) / 0.12 * 0.6 + 0.4 : 1) : 0.45 / i;
        ctx.beginPath(); ctx.arc(pa.x + (pb.x - pa.x) * uu, pa.y + (pb.y - pa.y) * uu, i === 0 ? r : r * (1 - i * 0.25), 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const k of dead) this.pool.release(k);
    ctx.globalAlpha = 1;
  }

  /** 도구 입자가 향할 화면 점: 부모(연결선 쪽), 루트면 도구를 쓰는 자식, 없으면 null(바깥으로) */
  _emitTarget(v) {
    const pv = v.node.parentId && this.vis.get(v.node.parentId);
    if (pv && !pv.hidden && pv._sp) return pv._sp;
    for (const id of this.children(v.id)) { const cv = this.vis.get(id); if (cv && !cv.hidden && cv._on && cv.node.status === 'active') return cv._sp; }
    return null;
  }

  _drawNode(ctx, v, now) {
    const t = this.tokens, L = t.isLight;
    const st = v.node.status;
    const active = st === 'active' && !v.scopeRecent;
    const pulse = active && !this.reduced ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (now + v.seed)) / 1.2) : 0;
    const R = v._R * (1 + 0.08 * pulse);
    const { x, y } = v._sp;
    const alpha = (v.baseOpacity ?? 1) * (v.exitF ?? 1);
    if (alpha < 0.01) return;
    const col = this._colorOf(v);
    if (R < 1.6) { ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.globalAlpha = 1; return; }
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
    stepOrbits(this, v, now);
    const sub = shape === 'sphere';
    const oOpt = sub && v._pd && v._pd.type === 'swarm' ? { spread: 1 + 0.32 * (v._pd.toolK || 0) } : undefined; // 위성 군단: 도구 때 산개
    drawOrbits(this, ctx, v, x, y, R, alpha, now, col, 0, oOpt);
    if (sub) drawSubPlanet(this, ctx, v, x, y, R, alpha, now, col, edge, 0);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1, R * (foc ? 0.12 : 0.07));
    if (shape === 'ico') {
      // 메인 = 기계 행성: 이음선·코어 광·해치·기어 띠·궤도 링·안테나
      drawMechPlanet(this, ctx, v, x, y, R, alpha, now, col, edge, pulse);
    } else if (shape === 'sphere') {
      // 서브에이전트 = 구름 띠·대기·위성
      drawSubPlanet(this, ctx, v, x, y, R, alpha, now, col, edge, 1);
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
    drawOrbits(this, ctx, v, x, y, R, alpha, now, col, 1, oOpt); // 궤도계 앞 반쪽
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
