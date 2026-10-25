// 의뢰인 창구(사용자 ↔ 메인) 3D 연출. 규칙은 client-core.mjs(순수, 2D 와 공용).
// 팀장 사무실 뒤 벽 화상 스크린 + 날아가는 의뢰서 카드 + 책상 위 메모 + 질문 선택지 카드 + 붉은 깜빡임 + 화면보호기.
import * as THREE from 'three';
import { ClientDesk, clientOp, CLIENT } from './client-core.mjs';
import { clientLocal, clientScreen, clientSpot } from './office-core.mjs';
import { roomFrame, endXf, DESK_TOP } from './props.js';

export class VxClient {
  constructor(view) {
    this.view = view;
    this.desks = new Map(); // 팀장(메인) id → ClientDesk
    this.st = { ixSeen: false, askId: null };
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
  }
  desk(id) { let d = this.desks.get(id); if (!d) { d = new ClientDesk(); this.desks.set(id, d); } return d; }
  clear() { this.desks.clear(); }

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
    for (const r0 of v.rooms) {
      if (r0.type !== 'office' || !r0.leadDesk || r0.external) continue;
      const lead = v.nodes.get(r0.ownerId);
      if (!lead || lead.kind !== 'main' || v._isDim(r0.ownerId)) continue;
      const d = this.desks.get(r0.ownerId);
      const waiting = lead.status === 'idle';
      const mode = d ? d.screen(now, waiting) : (waiting ? 'idle' : 'idle');
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
      // 날아가는 카드(세계 좌표): 스크린 → 팀장 책상
      if (d) {
        const cards = d.liveCards(now);
        if (cards.length) {
          const a = clientScreen(r0), ld = r0.leadDesk;
          for (const c of cards) {
            const u = (now - c.t0) / CLIENT.CARD_DUR, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
            const x = a.x + (ld.x - a.x) * e, z = a.z + (ld.z - a.z) * e, y = a.y + (DESK_TOP + 0.1 - a.y) * e + Math.sin(e * Math.PI) * 1.1;
            G.box(x, y, z, 0.34, 0.03, 0.26, c.kind === 'memo' ? this._c2.copy(pal.paper).lerp(tok.skill, 0.35) : c.kind === 'answer' ? this._c2.copy(pal.paper).lerp(tok.ok, 0.3) : pal.paper, now * 4);
          }
        }
        // 책상 위 메모(작업 중 추가 메시지)
        for (let i = 0; i < d.memo; i++) L.box(ld0(r0).x - 0.75 + (i % 3) * 0.05, DESK_TOP + 0.02 + i * 0.022, ld0(r0).z + 0.18 - (i % 2) * 0.04, 0.24, 0.018, 0.24, this._c2.copy(pal.paper).lerp(tok.skill, 0.45), 0.2 * (i % 3) - 0.2);
      }
    }
  }
}

function ld0(r) { return r.leadDesk; }
