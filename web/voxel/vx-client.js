// 의뢰인 창구(사용자 ↔ 메인) 3D 연출. 규칙은 client-core.mjs(순수, 2D 와 공용).
// 팀장 사무실 뒤 벽 화상 스크린 + 날아가는 의뢰서 카드 + 책상 위 메모 + 질문 선택지 카드 + 붉은 깜빡임 + 화면보호기.
import * as THREE from 'three';
import { ClientDesk, clientOp, CLIENT, cardLabel, cardPath } from './client-core.mjs';
import { clientLocal, clientScreen, clientSpot } from './office-core.mjs';
import { roomFrame, endXf, DESK_TOP } from './props.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { userBook, consoleLines, hitRect } from '../user-core.mjs'; // 사용자 콘솔(의뢰인 스크린 = 같은 장부·같은 문구·같은 카드)
import { ensureIxCss, ixKeyColor } from '../ix-core.mjs';

export class VxClient {
  constructor(view) {
    this.view = view;
    this.desks = new Map(); // 팀장(메인) id → ClientDesk
    this.st = { ixSeen: false, askId: null };
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
    // 스크린 이름표(마지막 입력 첫 몇 단어 · 상태 · 시간) + 집기 사각형
    ensureIxCss();
    this.screens = []; // 이번 프레임 {root, x, y, z}(세계, 스크린 가운데)
    this.hits = [];    // {root, x0,y0,x1,y1}(px, 캔버스 기준)
    this.labels = [];
    this.tags = []; // 카드 리본 글(CSS2D)
    this._v = new THREE.Vector3();
  }
  /** 카드 출발점: 다른 세션이 보낸 것은 보낸 세션 팀장 책상(없으면 그 캐릭터)이 이 화면에 보일 때 거기, 아니면 스크린 */
  _cardFrom(c, r0, a0) {
    c.sd = false;
    if (c.src !== 'peer' || !c.from || c.from === r0.ownerId) return a0;
    const v = this.view;
    if (!v.nodes.has(c.from) || (v._isDim && v._isDim(c.from))) return a0;
    const room = (v.rooms || []).find((q) => q.ownerId === c.from && q.leadDesk && !q.external);
    let p = null;
    if (room) p = { x: room.leadDesk.x, y: DESK_TOP + 0.1, z: room.leadDesk.z };
    else { const ch = v.chars && v.chars.get(c.from); if (ch && ch.pos && !ch.offstage && ch.state !== 'gone') p = { x: ch.pos.x, y: (ch.pos.y || 0) + 1.2, z: ch.pos.z }; }
    if (!p) return a0;
    c.sd = true;
    return p;
  }
  /** 리본 글 하나(풀 i) — 글자는 textContent 로만 */
  _tag(i, x, y, z, text, src, a) {
    let T = this.tags[i];
    if (!T) {
      const el = document.createElement('div');
      el.className = 'vx-card-tag';
      const o = new CSS2DObject(el);
      o.center.set(0.5, 1); o.visible = false;
      this.view.scene.add(o);
      T = this.tags[i] = { o, el, text: null, src: undefined };
    }
    T.o.position.set(x, y, z);
    if (T.text !== text) { T.el.textContent = text; T.text = text; }
    if (T.src !== src) { T.el.dataset.src = src || 'human'; T.src = src; }
    T.el.style.opacity = String(Math.max(0, Math.min(1, a)));
    const col = ixKeyColor('user', !!(this.view.tokens && this.view.tokens.isLight));
    if (T.col !== col) { T.el.style.setProperty('--ix-c', col); T.col = col; }
    if (!T.o.visible) T.o.visible = true;
  }
  _label(i) {
    let L = this.labels[i];
    if (L) return L;
    const el = document.createElement('div');
    el.className = 'ix-con';
    const b = document.createElement('b'), sp = document.createElement('span');
    el.append(b, sp);
    const o = new CSS2DObject(el);
    o.center.set(0.5, 1);
    o.visible = false;
    this.view.scene.add(o);
    L = this.labels[i] = { o, el, b, sp, text: null, status: null, cls: '' };
    return L;
  }
  /** 화면 px(캔버스 기준) → 스크린 주인(메인) id | null */
  consoleAt(x, y, rect) {
    const h = hitRect(this.hits, x, y, 6);
    if (h) return h.root;
    for (const L of this.labels) {
      if (!L.o.visible || !L.root) continue;
      const r = L.el.getBoundingClientRect();
      if (r.width && x + rect.left >= r.left && x + rect.left <= r.right && y + rect.top >= r.top && y + rect.top <= r.bottom) return L.root;
    }
    return null;
  }
  consolePos(root) { const c = this.screens.find((q) => q.root === root); return c ? this._v.set(c.x, c.y, c.z) : null; }
  /** 스크린 이름표·집기 사각형(프레임마다, draw 뒤) */
  _overlay() {
    const v = this.view, cam = v.camera, W = v.container.clientWidth || 1, H = v.container.clientHeight || 1;
    const p = this._p || (this._p = new THREE.Vector3());
    this.hits.length = 0;
    const sized = [];
    for (const c of this.screens) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
      for (const [dx, dz, dy] of [[-1.2, 0, -0.65], [1.2, 0, 0.65], [0, -1.2, -0.65], [0, 1.2, 0.65]]) {
        p.set(c.x + dx, c.y + dy, c.z + dz).project(cam);
        if (p.z > 1) { behind = true; break; }
        const sx = (p.x * 0.5 + 0.5) * W, sy = (-p.y * 0.5 + 0.5) * H;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      if (behind) continue;
      // 벽 방향을 모르는 근사(가로·깊이 둘 다 넣은 상자) — 가운데 70% 만 집기
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = Math.max(9, (x1 - x0) * 0.35), hh = Math.max(6, (y1 - y0) * 0.4);
      this.hits.push({ root: c.root, x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh });
      sized.push({ c, px: hw * 2 });
    }
    sized.sort((a, b) => b.px - a.px);
    const nowMs = v.clock ? v.clock() : Date.now();
    let k = 0;
    for (const { c, px } of sized) {
      if (px < 30 || k >= 8) break;
      const info = consoleLines(userBook.get(c.root), nowMs);
      const L = this._label(k++);
      L.root = c.root;
      L.o.position.set(c.x, c.y + 0.82, c.z);
      if (L.text !== info.text) { L.b.textContent = info.text || ''; L.b.hidden = !info.text; L.text = info.text; }
      if (L.status !== info.status) { L.sp.textContent = info.status; L.status = info.status; }
      const cls = 'ix-con vx-con st-' + info.state;
      if (L.cls !== cls) { L.el.className = cls; L.cls = cls; }
      L.el.style.opacity = String(c.a ?? 1);
      const col = ixKeyColor('user', !!(v.tokens && v.tokens.isLight));
      if (L.col !== col) { L.el.style.setProperty('--ix-c', col); L.col = col; }
      if (!L.o.visible) L.o.visible = true;
    }
    for (; k < this.labels.length; k++) { const L = this.labels[k]; L.root = null; if (L.o.visible) L.o.visible = false; }
  }
  dispose() { for (const L of [...this.labels, ...this.tags]) { L.o.removeFromParent(); L.el.remove(); } this.labels = []; this.tags = []; }
  desk(id) { let d = this.desks.get(id); if (!d) { d = new ClientDesk(); this.desks.set(id, d); } return d; }
  clear() { this.desks.clear(); this.screens.length = 0; this.hits.length = 0; }

  /** app.onEvent → view.flowEvent(라이브·재생·mock, quiet 제외) */
  event(ev) {
    const v = this.view;
    const isMain = (id) => { const n = v.nodes.get(id); return !!n && n.kind === 'main'; };
    const o = clientOp(ev, isMain, this.st);
    if (!o || !o.lead || !v.nodes.has(o.lead)) return false;
    if (o.op === 'ask') this.st.askId = o.toolUseId || null;
    if (o.op === 'answer' || o.op === 'alert') this.st.askId = null;
    const n = v.nodes.get(o.lead);
    const busy = !!n && n.status === 'active' && (n.openTools || []).length > 0;
    const now = v._now;
    const d = this.desk(o.lead);
    d.ixSeen = this.st.ixSeen;
    const ok = d.apply(o, now, busy);
    if (ok && o.op === 'alert') { // 그 사무실 사람들이 멈칫
      const room = v.layout && v.layout.roomOf ? v.layout.roomOf.get(o.lead) : null;
      for (const ch of v.chars.values()) if (ch.room && ch.room.id === room) ch.flinchUntil = now + CLIENT.FLINCH;
    }
    return ok;
  }

  /** 매 프레임: 팀장 심부름(스크린 앞)·카드 읽기 */
  step(now) {
    const v = this.view;
    for (const [id, d] of this.desks) {
      d.step(now);
      const ch = v.chars.get(id);
      if (!ch || !ch.room) continue;
      const er = d.errand(now);
      if (er) { const sp = clientSpot(ch.room); if (sp) ch.errand = { spot: sp, until: er.until, kind: er.kind }; }
      ch.readUntil = d.readUntil;
    }
  }

  /** 스크린·카드·메모(동적 묶음 B) */
  draw(B, now) {
    const v = this.view, tok = v.tokens, pal = v.pal;
    const G = B.glow, L = B.lit;
    const user = tok['flow-call'] || tok['k-main'];
    this.screens.length = 0;
    let tagN = 0;
    for (const r0 of v.rooms) {
      if (r0.type !== 'office' || !r0.leadDesk || r0.external) continue;
      const lead = v.nodes.get(r0.ownerId);
      if (!lead || lead.kind !== 'main' || v._isDim(r0.ownerId)) continue;
      const d = this.desks.get(r0.ownerId);
      const waiting = lead.status === 'idle';
      const mode = d ? d.screen(now, waiting) : (waiting ? 'idle' : 'idle');
      const wsc = clientScreen(r0); // 세계 좌표(이름표·집기·카드 자리)
      const r0Fade = wsc && v._fxA ? v._fxA(wsc.x, wsc.z) : 1;
      if (wsc) this.screens.push({ root: r0.ownerId, x: wsc.x, y: wsc.y, z: wsc.z, a: r0Fade });
      const cl = clientLocal(r0);
      const r = roomFrame(r0, B);
      const sx = r.origin.x + cl.x, sz = r.origin.z + cl.z + cl.inward * 0.06, sy = 1.5, W = 2.4, H = 1.3;
      let bgc;
      if (mode === 'alert') bgc = Math.floor(now * 4) % 2 ? this._c.copy(tok.error) : this._c.copy(tok.error).multiplyScalar(0.35);
      else if (mode === 'saver') bgc = this._c.copy(pal.screenOff);
      else if (mode === 'idle') bgc = this._c.copy(pal.screenDim).lerp(user, 0.12);
      else bgc = this._c.copy(pal.screenDim).lerp(user, 0.35);
      G.box(sx, sy, sz, W, H, 0.03, bgc);
      const zf = sz + cl.inward * 0.03;
      if (mode === 'on' || mode === 'report' || mode === 'idle' || mode === 'ask') {
        // 의뢰인(화상 속 사람): 머리·어깨 실루엣
        const k = mode === 'idle' ? 0.35 : 1;
        const pc = this._c2.copy(pal.screenDim).lerp(user, 0.55 + 0.45 * k);
        G.box(sx - 0.45, sy + 0.12, zf, 0.3, 0.32, 0.01, pc);
        G.box(sx - 0.45, sy - 0.32, zf, 0.7, 0.36, 0.01, pc);
        if (mode === 'report') for (let i = 0; i < 3; i++) { const h = 0.2 + 0.45 * ((Math.sin(now * 1.5 + i * 1.3) + 1) / 2); G.box(sx + 0.3 + i * 0.25, sy - 0.5 + h / 2, zf, 0.16, h, 0.01, tok.ok); }
        if (mode === 'ask') { G.box(sx + 0.5, sy + 0.18, zf, 0.1, 0.3, 0.01, tok.skill); G.box(sx + 0.5, sy - 0.12, zf, 0.1, 0.1, 0.01, tok.skill); }
        if (mode === 'on') G.box(sx + 0.45, sy, zf, 0.8 * (0.6 + 0.4 * Math.sin(now * 3)), 0.06, 0.01, user); // 말하는 중 음량 막대
        if (mode === 'idle') { // 대기 중에도 빈 화면이 아니게: 글줄 둘(마지막 입력·상태)
          const tc = this._c2.copy(pal.screenDim).lerp(user, 0.6);
          G.box(sx + 0.38, sy + 0.16, zf, 0.7, 0.05, 0.01, tc);
          G.box(sx + 0.24, sy - 0.02, zf, 0.42, 0.05, 0.01, tc);
          G.box(sx + 0.3, sy - 0.24, zf, 0.56, 0.04, 0.01, this._c2.copy(pal.screenDim).lerp(user, 0.35));
        }
      } else if (mode === 'saver') {
        const a = now * 0.4;
        G.box(sx + Math.sin(a) * 0.9, sy + Math.cos(a * 1.3) * 0.4, zf, 0.08, 0.08, 0.01, this._c2.copy(pal.screenDim));
      }
      // 질문 선택지 카드(스크린 앞에 펼침)
      if (d && d.ask) {
        const n = d.ask.n, open = Math.min(1, (now - d.ask.t0) / 0.5);
        for (let i = 0; i < n; i++) {
          const u = n > 1 ? i / (n - 1) - 0.5 : 0;
          const chosen = d.ask.chosen === i, glowK = chosen ? 0.6 + 0.4 * Math.sin(now * 8) : 0;
          const s = chosen ? 1.25 : d.ask.chosen >= 0 ? 0.8 : 1;
          const c = chosen ? this._c2.copy(tok.ok) : this._c2.copy(pal.paper).lerp(user, 0.25);
          if (chosen) c.lerp(pal.paper, 0.3 * glowK);
          G.box(sx + u * 2.2 * open, 0.95 + (chosen ? 0.12 : 0), sz + cl.inward * (0.55 + 0.1 * Math.abs(u)), 0.42 * s, 0.3 * s, 0.015, c);
        }
      }
      endXf(B);
      // 날아가는 카드(세계 좌표): 스크린 → 팀장 책상. 다른 세션이 보낸 것은 보낸 세션 팀장 책상이 보이면 거기서 출발, 리본 글 앞에 ◇/⇄
      if (d) {
        const cards = d.liveCards(now);
        if (cards.length) {
          const a0 = clientScreen(r0), ld = r0.leadDesk;
          const b = { x: ld.x, y: DESK_TOP + 0.1, z: ld.z };
          for (const c of cards) {
            const p = cardPath(this._cardFrom(c, r0, a0), b, (now - c.t0) / CLIENT.CARD_DUR, c.sd ? 1.8 : 1.1);
            G.box(p.x, p.y, p.z, 0.34, 0.03, 0.26, c.kind === 'memo' ? this._c2.copy(pal.paper).lerp(tok.skill, 0.35) : c.kind === 'answer' ? this._c2.copy(pal.paper).lerp(tok.ok, 0.3) : pal.paper, now * 4);
          }
        }
        // 리본 글(흐름 리본과 같은 글: ◇ Interactive · ⇄ 다른 세션 + 첫 몇 단어) — 날아가는 동안 카드 위, 닿은 뒤 잠깐 책상 위
        if (r0.leadDesk) {
          const a0 = clientScreen(r0), ld = r0.leadDesk, b = { x: ld.x, y: DESK_TOP + 0.1, z: ld.z };
          for (const c of d.liveTags(now)) {
            const lab = cardLabel(c);
            if (!lab || tagN >= CLIENT.TAGS_MAX * 2) continue;
            const u = (now - c.t0) / CLIENT.CARD_DUR;
            const p = cardPath(this._cardFrom(c, r0, a0), b, u, c.sd ? 1.8 : 1.1);
            const fade = u <= 1 ? 1 : Math.max(0, 1 - ((now - c.t0) - CLIENT.CARD_DUR) / CLIENT.TAG_HOLD);
            this._tag(tagN++, p.x, p.y + 0.45, p.z, lab, c.src, fade * (r0Fade ?? 1));
          }
        }
        // 책상 위 메모(작업 중 추가 메시지)
        for (let i = 0; i < d.memo; i++) L.box(ld0(r0).x - 0.75 + (i % 3) * 0.05, DESK_TOP + 0.02 + i * 0.022, ld0(r0).z + 0.18 - (i % 2) * 0.04, 0.24, 0.018, 0.24, this._c2.copy(pal.paper).lerp(tok.skill, 0.45), 0.2 * (i % 3) - 0.2);
      }
    }
    for (let k = tagN; k < this.tags.length; k++) if (this.tags[k].o.visible) this.tags[k].o.visible = false;
  }
}

function ld0(r) { return r.leadDesk; }
