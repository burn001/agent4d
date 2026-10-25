// Flow 2D(저사양). 3D Flow 의 시각 언어를 Canvas 2D 한 장으로:
// 육각 칩(상태색 테두리·완료 점선·중지 회색·오류 맥동·종류 아이콘·도구 스피너·컨텍스트 고리) · 곡선 빔(부모→자식, 작업 중 밝게, 추정 연결 점선,
// 퇴장 때 자식 끝부터 감김) · 흐름 패킷(가벼운 점 + 잔광 점 2개) · 말풍선(DOM) · 배치 장치 칩(진행 막대·표시등·상태 띠 5칸) ·
// 도구 카드(방향 슬롯, 실제 출력 panel.lines/marks, 자물쇠, 가까우면 본문·멀면 머리줄) · 전체 보기 섬(원판·고리·이름표).
// 생략: 글로우 셰이더·깊이 입자·육각 격자 맥동·바닥 조명·퇴장 입자·신호 열화 후처리·기상 — 대신 옅은 바깥 육각·단색 고리로.
import { FlatView } from './flat-view.js';
import { t } from '../i18n.mjs';
import { FlatArt } from './art2d.js'; // 작업 대상 층(켤 때만 만든다)
import { paletteOf, nodeVisualState, stateColor, kindIcon, breathe, NODE_STATE, BEAM, beamControls, beamPoint, beamAlpha, flowDash, FLOW_DASH, packetWobble } from '../flowview/flow-style.mjs';
import { FLOW, PacketPool, planFlow, easeInOut, linkPackets } from '../flow-core.mjs';
import { isGuessLink } from '../batch-core.mjs';
import { DEG, degOf, degOfLink, packetGone, lineFlicker, brokenDash } from '../degrade-core.mjs';
const DG_DASH = [0, 0, 0, 0]; // 끊긴 선 무늬(재사용)

import { toScreen, camScale, hexPath, bezPrefix, bezSuffix, ctxRingTone } from './flat-core.mjs';
import { MONO, rrect, setFont, drawCards, drawRings, drawDeviceFace, drawIslands, BubbleLayer } from './flat-draw.js';

const TOP_ACTIVE = 6;

export class Flow2DView extends FlatView {
  static modeId = 'flow';
  static modeLabel = t('flat.mode.flow');

  constructor(container, labelContainer, opts = {}) {
    super(container, labelContainer, opts);
    this.pool = new PacketPool(FLOW.MAX_PACKETS, FLOW.PER_NODE);
    this.spawnAlpha = 0.22; // 띄움 점선은 일반 연결선보다 옅게
    this.flowState = { lastUp: new Map(), lastOut: new Map() };
    this.bubbles = new BubbleLayer(this);
    this._topActive = new Set();
    this._labelFontPx = 11; // 라벨 글자 크기(이름만 모드 폭 추정)
    this.overviewFacing = true; // Flow 3D 와 같은 섬 안 배치(마주 보기·파이)
    this.applyTheme();
  }

  // ---------- 흐름·말풍선 ----------
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
      s.kind = pl.kind; s.from = pl.from; s.to = pl.to; s.color = pl.color; s.size = pl.size || 1; s.dur = dur; s.up = pl.dir === 'up';
    }
  }
  say(id, text, opts = {}) {
    const t = opts.type;
    if (t !== 'text' && t !== 'user' && t !== 'result') return;
    const role = t === 'result' && opts.ok === false ? 'error' : t;
    if (this.bubbles.push(id, role, text)) this.invalidate();
  }
  _dropped(id) { this.bubbles.drop(id); }
  reset() { super.reset(); if (this.pool) { this.pool.clear(); this.flowState.lastUp.clear(); this.flowState.lastOut.clear(); this.bubbles.clear(); } }
  _actHtml(v) {
    if (this.bubbles && this.bubbles.shown.has(v.id) && !v.icons.size) return '';
    return super._actHtml(v);
  }

  applyTheme() {
    super.applyTheme();
    const t = this.tokens;
    const P = this.P = paletteOf(t.isLight);
    const ls = this.labelContainer.style;
    ls.setProperty('--flow-text', P.text); ls.setProperty('--flow-dim', P.textDim); ls.setProperty('--flow-holo', P.holo);
    ls.setProperty('--flow-tool', P.tool); ls.setProperty('--flow-bg', t.isLight ? 'rgba(255,255,255,.82)' : 'rgba(5,5,16,.72)');
    this._stateCol = [0, 1, 2, 3, 4, 5].map((s) => stateColor(s, t.isLight));
  }

  _labelPass(now) {
    super._labelPass(now);
    // 최근 활동 상위 노드(카드 최소 크기·본문 우선)
    const act = [];
    for (const v of this.vis.values()) if (v.node.status === 'active' && !v.hidden) act.push(v);
    act.sort((a, b) => (b.node.lastActivityAt || '').localeCompare(a.node.lastActivityAt || ''));
    this._topActive = new Set(act.slice(0, TOP_ACTIVE).map((v) => v.id));
  }

  // ---- 작업 대상 층(섬 바닥층). 끄면 객체가 없고 그리기·맞춤에 아무것도 더하지 않는다 ----
  setArtifacts({ on, book, fx, style } = {}) {
    if (on && !this.art && book && fx) this.art = new FlatArt(this, { book, fx, style });
    else if (!on && this.art) { this.art.dispose(); this.art = null; }
    this.invalidate();
    return !!this.art;
  }
  get artOn() { return !!this.art; }
  pickArtifact(clientX, clientY) {
    if (!this.art) return null;
    const r = this.canvas.getBoundingClientRect();
    return this.art.pick(clientX - r.left, clientY - r.top);
  }
  artPos(pid, id) { return this.art ? this.art.posOf(pid, id) : null; }
  setArtFoot(pid, nodeId) { if (this.art) { this.art.st.setFoot(pid, nodeId); this.invalidate(); } }
  setArtSelected(t) { if (this.art) { this.art.st.sel = t || null; this.invalidate(); } }
  fitExtra(pts, scope) { if (this.art) this.art.fitPoints(pts, scope); }

  _updateExtra(now) {
    let level = this.art ? this.art.level(now) : 0;
    if (this.pool.active.length) level = 2;
    level = Math.max(level, this.bubbles.level(now));
    if (this.scope.mode === 'all' && !this.reduced) for (const c of this._clusterV.values()) if (c.busy) { level = Math.max(level, 1); break; }
    return level;
  }

  // ---------- 그리기 ----------
  _drawScene(ctx, now) {
    const W = this.W, H = this.H, P = this.P, t = this.tokens;
    this._font = null; ctx.font = '10px sans-serif';
    ctx.fillStyle = P.void;
    ctx.fillRect(0, 0, W, H);
    const s = this._s = camScale(this.cam, H);
    if (this.scope.mode === 'all') drawIslands(this, ctx, now, s);
    if (this.art) this.art.draw(ctx, now); // 바닥층(노드·빔 아래)
    // 노드 화면 자리(한 번 계산)
    for (const v of this.vis.values()) {
      if (v.gone || v.hidden) { v._on = false; continue; }
      const p = toScreen(this.cam, W, H, v.pos.x, v.pos.z, v._sp || (v._sp = {}));
      const R = v.r * (v.drawS || 1) * s;
      v._R = R;
      v._on = p.x > -R - 300 && p.x < W + R + 300 && p.y > -R - 300 && p.y < H + R + 300; // 화면 밖(여유 300px)은 그리지 않음
    }
    this._drawSpawnLinks(ctx); // 띄움 점선 — 빔 아래
    this._drawBeams(ctx, now, s);
    this._drawPackets(ctx, now);
    this.sess.drawUnder(ctx, now); // 충돌 곡선·세션 간 메시지
    for (const v of this.vis.values()) if (v._on) this._drawChip(ctx, v, now);
    this.sess.drawOver(ctx, now); // 파일명 칩
    drawRings(this, ctx, now, s);
    drawCards(this, ctx, now, s);
    this.bubbles.place(now);
    if (t && this.pendingMode) { /* 배지는 DOM */ }
  }

  _drawBeams(ctx, now, s) {
    const P = this.P, L = this.tokens.isLight;
    const a = {}, b = {}, c1 = {}, c2 = {};
    const wScale = Math.max(1, (this.cam.D / 22));
    const pk = this.reduced ? null : linkPackets(this.pool.active, now, (id) => { const v = this.vis.get(id); return v ? v.node.parentId : null; });
    for (const [cv, pv] of this.links) {
      if (cv.gone || pv.gone || cv.hidden || pv.hidden) continue;
      if (!cv._on && !pv._on) continue;
      const st = cv.node.status;
      let col = cv.sessC || P.holo, al = beamAlpha(st, L, cv.stale), active = false; // 세션 색, 은은하게
      if (st === 'active') { active = true; if (cv.icons.size && !cv.sessC) col = P.tool; }
      else if (st === 'error') col = P.error;
      else if (st === 'stopped') col = P.stopped;
      const sk = Math.min(cv.scopeK ?? 1, pv.scopeK ?? 1);
      const exiting = cv.exiting != null;
      const tEnd = exiting ? 1 - (cv._linkK || 0) : 1;
      if (exiting) al = Math.max(al, BEAM.idleAlpha * (L ? 1.6 : 1.2));
      al *= Math.min(1, sk * 1.2) * (exiting ? 0.35 + 0.65 * (cv.exitF ?? 1) : Math.min(cv.exitF ?? 1, 1));
      if (al < 0.01 || tEnd < 0.02) continue;
      const dashed = isGuessLink(cv.node);
      if (dashed && sk >= 0.5 && !exiting) al = Math.max(al, BEAM.idleAlpha * 1.6);
      const cp = beamControls(pv.pos, cv.pos);
      toScreen(this.cam, this.W, this.H, pv.pos.x, pv.pos.z, a);
      toScreen(this.cam, this.W, this.H, cv.pos.x, cv.pos.z, b);
      let pts;
      if (cp) {
        toScreen(this.cam, this.W, this.H, cp.c1x, cp.c1z, c1);
        toScreen(this.cam, this.W, this.H, cp.c2x, cp.c2z, c2);
        pts = tEnd < 1 ? bezPrefix(a, c1, c2, b, tEnd) : [a, c1, c2, b];
      } else pts = [a, a, b, b];
      const wpx = Math.max(1, Math.min(3, ((BEAM.startW + BEAM.endW) / 2) * s * wScale * 0.9));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
      if (active && !dashed && !this.reduced) {
        ctx.globalAlpha = BEAM.glowAlpha * (L ? 1.5 : 1);
        ctx.strokeStyle = col; ctx.lineWidth = wpx + Math.max(3, BEAM.glowW * s * wScale);
        ctx.stroke();
      }
      // 신호 열화: 그 세션 빔은 끊긴 토막으로 깜빡인다
      const dg = DEG.on ? degOf(cv.id) : 0, tt = DEG.reduced ? 0 : DEG.t, sd = dg > 0 ? (cv.seed * 1e6) | 0 : 0;
      ctx.globalAlpha = Math.min(1, al * 1.4) * (dg > 0 ? lineFlicker(sd, tt, dg) : 1);
      ctx.strokeStyle = col; ctx.lineWidth = wpx;
      if (dashed) ctx.setLineDash([6, 5]);
      else if (dg > 0) ctx.setLineDash(brokenDash(sd, tt, dg, Math.max(3, s * 0.5), DG_DASH));
      ctx.stroke();
      if (dashed || dg > 0) ctx.setLineDash([]);
      // 선 위를 늘 흐르는 가는 대시(부모 → 자식, 상태별 속도·밝기). 끝남·중지·점선·퇴장은 멈춤
      const fd = !dashed && !exiting && sk >= 0.5 && !this.reduced ? flowDash(st) : null;
      if (fd && fd.speed) {
        const g = FLOW_DASH.gap * s, dl = Math.max(2, 0.7 * s);
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
        ctx.setLineDash([dl, Math.max(dl, g - dl)]); ctx.lineDashOffset = -now * fd.speed * s;
        ctx.globalAlpha = Math.min(1, al * 1.4 * (1 + fd.amp * 0.55)); ctx.lineWidth = Math.max(1, wpx * 0.9); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      // 패킷이 지나가는 구간만 잠깐 밝게(빔 위 머리 뒤쪽 짧은 토막)
      const es = pk && sk >= 0.5 && cp ? pk.get(pv.id + '|' + cv.id) : null;
      if (es) for (const e of es) {
        const t0 = Math.max(0, e - BEAM.packetSpan * 1.6), t1 = Math.min(tEnd, e + BEAM.packetSpan * 0.6);
        if (t1 <= t0) continue;
        const q = bezPrefix(a, c1, c2, b, t1), seg = t0 > 0 ? bezSuffix(q, t0 / t1) : q;
        ctx.beginPath(); ctx.moveTo(seg[0].x, seg[0].y); ctx.bezierCurveTo(seg[1].x, seg[1].y, seg[2].x, seg[2].y, seg[3].x, seg[3].y);
        ctx.globalAlpha = Math.min(1, BEAM.packetBoost * (L ? 1.1 : 1)); ctx.lineWidth = wpx + 0.6; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  _pktColor(c) {
    const P = this.P;
    return c === 'call' ? P.dispatch : c === 'ok' ? P.ret : c === 'error' ? P.error : c === 'stopped' ? P.stopped : c === 'output' ? P.output : P.text;
  }
  _drawPackets(ctx, now) {
    const dead = [];
    const pt = { x: 0, y: 0, z: 0 }, sp = {};
    const s = this._s;
    for (const k of this.pool.active) {
      const fv = this.vis.get(k.from), tv = this.vis.get(k.to);
      if (!fv || !tv || fv.hidden || tv.hidden) { dead.push(k); continue; }
      const u = (now - k.t0) / k.dur;
      if (u >= 1) { dead.push(k); continue; }
      if (DEG.on && !DEG.reduced && packetGone((k.t0 * 1000) | 0, u, degOfLink(k.from, k.to))) continue; // 패킷 중간 소실
      const e = easeInOut(Math.max(0, u));
      // 호출은 부모→자식, 결과는 같은 빔을 거꾸로(곡선 빔 위)
      const pa = k.up ? tv.pos : fv.pos, pb = k.up ? fv.pos : tv.pos;
      const col = this._pktColor(k.color);
      ctx.fillStyle = col;
      const r = Math.max(1.6, Math.min(6, 0.38 * k.size * s));
      for (let i = 2; i >= 0; i--) {
        const uu = Math.max(0, e - i * 0.06);
        beamPoint(pt, pa, pb, k.up ? 1 - uu : uu, this.reduced ? 0 : packetWobble(k.up ? 1 - uu : uu, now));
        toScreen(this.cam, this.W, this.H, pt.x, pt.z, sp);
        ctx.globalAlpha = i === 0 ? (u > 0.88 ? (1 - u) / 0.12 * 0.6 + 0.4 : 1) : 0.45 / i;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, i === 0 ? r : r * (1 - i * 0.25), 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const k of dead) this.pool.release(k);
    ctx.globalAlpha = 1;
  }

  _drawChip(ctx, v, now) {
    const P = this.P, L = this.tokens.isLight;
    const st = nodeVisualState(v.node.status, v.icons.size);
    const R = v._R * (this.reduced ? 1 : breathe(st, now, v.seed));
    const { x, y } = v._sp;
    const sk = v.scopeK ?? 1;
    const endK = st === NODE_STATE.done ? 0.7 : st === NODE_STATE.stopped ? 0.6 : 1;
    const alpha = (v.exitF ?? 1) * Math.min(1, sk * 1.3) * endK * (v.stale ? 0.7 : 1);
    if (alpha < 0.01) return;
    const col = v.sessC && v.kind === 'main' && !v.node.parentId && (st === NODE_STATE.idle || st === NODE_STATE.thinking || st === NODE_STATE.tool) ? v.sessC : this._stateCol[st]; // 메인 테두리 = 세션 색
    if (R < 1.6) { ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.globalAlpha = 1; return; }
    const foc = v.id === this.focusId || v.id === this.hoverId;
    if (v.device) { this._drawDevice(ctx, v, x, y, R, col, alpha, now); return; }
    const hp = this._hp || (this._hp = new Array(12));
    // 옅은 바깥 육각(글로우 대신) — 작은 칩은 생략
    if (R > 8 || foc) {
      hexPath(ctx, x, y, R * (foc ? 1.32 : 1.2), hp);
      ctx.globalAlpha = alpha * (foc ? 0.3 : st === NODE_STATE.thinking || st === NODE_STATE.tool ? 0.16 : 0.08);
      ctx.fillStyle = col;
      ctx.fill();
    }
    // 몸체: 어두운 안쪽 + 상태색 테두리(완료 점선·오류 맥동·중지 회색 얇게)
    hexPath(ctx, x, y, R, hp);
    ctx.globalAlpha = alpha * (L ? 0.92 : 0.88);
    ctx.fillStyle = P.interior; ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col;
    let lw = Math.max(1, R * 0.09);
    if (st === NODE_STATE.stopped) lw = Math.max(1, R * 0.05);
    if (st === NODE_STATE.error && v.errorSince != null && !this.reduced) lw *= 1 + 0.5 * (0.5 + 0.5 * Math.sin(now * 6));
    if (foc) lw *= 1.5;
    ctx.lineWidth = lw;
    if (st === NODE_STATE.done) ctx.setLineDash([Math.max(2, R * 0.28), Math.max(2, R * 0.2)]);
    ctx.stroke();
    if (st === NODE_STATE.done) ctx.setLineDash([]);
    // 가운데 종류 아이콘
    if (R > 6) this._icon(ctx, kindIcon(v.kind), x, y, R * 0.62, this.kindColor(v.kind), now);
    // 도구 사용 중: 도는 호(스피너), 생각 중: 도는 점 하나
    if (!this.reduced && R > 5) {
      if (st === NODE_STATE.tool) {
        ctx.strokeStyle = P.tool; ctx.lineWidth = Math.max(1.2, R * 0.08);
        const a0 = now * 4 + v.seed;
        ctx.beginPath(); ctx.arc(x, y, R * 1.12, a0, a0 + 1.3); ctx.stroke();
      } else if (st === NODE_STATE.thinking) {
        const a0 = now * 2.4 + v.seed;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x + Math.cos(a0) * R * 1.12, y + Math.sin(a0) * R * 1.12, Math.max(1.2, R * 0.07), 0, Math.PI * 2); ctx.fill();
      }
    }
    // 컨텍스트 사용률 고리
    const c = v.node.meta && v.node.meta.ctx;
    if (c && c.limit && R > 5) {
      const f = Math.min(1, Math.max(0, c.used / c.limit));
      if (f > 0.005) {
        ctx.strokeStyle = P[ctxRingTone(f * 100)]; ctx.lineWidth = Math.max(1.2, R * 0.07);
        ctx.globalAlpha = alpha * 0.85;
        ctx.beginPath(); ctx.arc(x, y, R * 1.3, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
      }
    }
    // 대기 중 카드 수 +N
    const q = this.holo.book.queued(v.id);
    if (q > 0 && R > 4) {
      ctx.globalAlpha = alpha; ctx.fillStyle = P.tool; setFont(this, ctx, `600 ${Math.round(Math.max(9, Math.min(12, R * 0.5)))}px ${MONO}`);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('+' + q, x + R * 0.9, y + R * 0.6);
    }
    ctx.globalAlpha = 1;
  }

  _icon(ctx, k, x, y, r, col, now) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    if (k === 0) { // 별(메인): 네 갈래
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? r * 0.28 : r * 0.78; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill(); return;
    }
    if (k === 1) { ctx.moveTo(x, y - r * 0.55); ctx.lineTo(x + r * 0.55, y); ctx.lineTo(x, y + r * 0.55); ctx.lineTo(x - r * 0.55, y); ctx.closePath(); ctx.stroke(); return; }
    if (k === 2) { ctx.rect(x - r * 0.42, y - r * 0.42, r * 0.84, r * 0.84); ctx.stroke(); return; }
    if (k === 3) { ctx.moveTo(x, y - r * 0.5); ctx.lineTo(x + r * 0.48, y + r * 0.34); ctx.lineTo(x - r * 0.48, y + r * 0.34); ctx.closePath(); ctx.stroke(); return; }
    if (k === 4) { ctx.moveTo(x, y - r * 0.36); ctx.lineTo(x + r * 0.36, y); ctx.lineTo(x, y + r * 0.36); ctx.lineTo(x - r * 0.36, y); ctx.closePath(); ctx.fill(); return; }
    if (k === 5) { ctx.moveTo(x - r * 0.4, y - r * 0.32); ctx.lineTo(x + r * 0.02, y); ctx.lineTo(x - r * 0.4, y + r * 0.32); ctx.moveTo(x + r * 0.1, y + r * 0.36); ctx.lineTo(x + r * 0.48, y + r * 0.36); ctx.stroke(); return; }
    // 6 파형(모니터)
    const ph = this.reduced ? 0 : now * 4;
    for (let i = 0; i <= 12; i++) { const u = -0.55 + (i / 12) * 1.1; const px = x + u * r, py = y - Math.sin(u * 9 - ph) * r * 0.22; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke();
  }

  /** 배치 장치: 넓은 모서리 둥근 칩 · 위 진행 막대 · 오른쪽 위 표시등 · 아래 상태 띠 5칸 */
  _drawDevice(ctx, v, x, y, R, col, alpha, now) {
    const P = this.P;
    const w = R * 2.9, h = R * 1.64;
    rrect(ctx, x - w / 2, y - h / 2, w, h, h * 0.2);
    ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = P.interior; ctx.fill();
    ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, R * 0.08); ctx.stroke();
    drawDeviceFace(this, ctx, v, x, y, w, h, R, alpha, now);
    ctx.globalAlpha = 1;
  }

  dispose() {
    this.bubbles.dispose();
    super.dispose();
  }
}
