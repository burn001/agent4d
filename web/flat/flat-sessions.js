// 2D 화면의 여러 live 세션 연출 — 3D session-fx.js 와 같은 규칙(곡선 한 쌍당 하나, 강 = 굵게, 파일명 칩 왕복,
// 30초 페이드, 세션 간 메시지 패킷). Canvas 2D 만 쓴다(three 없음).
import { conflictPairs, pairChipText } from '../conflict-core.mjs';
import { arcControl, bez2 } from '../session-core.mjs';
import { toScreen } from './flat-core.mjs';
import { fxShown, fxAlpha } from '../proj-fade.mjs';

const MSG_DUR = 1.5;

export class FlatSessions {
  constructor(view) { this.view = view; this.book = null; this.msgs = []; this.pairs = []; this._chipRects = []; }
  setBook(book) { this.book = book; }

  /** 페이드 중인 메인도 그대로 쓰고 투명도(fxAlpha)를 곱한다(문턱으로 중간에 꺼지지 않게) */
  _vis(id) {
    const v = this.view.vis.get(id);
    return fxShown(v) ? v : null;
  }

  /** 세션 간 메시지: 보내는 메인 → 받는 메인 */
  message(ev) {
    if (!this._vis(ev.nodeId) || !this._vis(ev.peer)) return false;
    this.msgs.push({ from: ev.nodeId, to: ev.peer, t0: performance.now() / 1000 });
    if (this.msgs.length > 24) this.msgs.shift();
    this.view.invalidate();
    return true;
  }

  /** 갱신 단계: 충돌이 있으면 칩 왕복(15fps 이상), 메시지 패킷이 날면 30fps */
  level(now) {
    this.pairs = this.book ? conflictPairs(this.book.items(Date.now())) : [];
    this.msgs = this.msgs.filter((m) => now - m.t0 < MSG_DUR);
    if (this.msgs.length) return 2;
    return this.pairs.length ? 1 : 0;
  }

  /** 곡선·패킷(노드 아래) */
  drawUnder(ctx, now) {
    const v = this.view, t = v.tokens, W = v.W, H = v.H;
    const a = {}, b = {}, c = {};
    const col = t.conflict || '#ff9a3c';
    const pairN = new Map();
    this._geo = [];
    for (const p of this.pairs) {
      const A = this._vis(p.a), B = this._vis(p.b);
      if (!A || !B) continue;
      const pk = p.id;
      const slot = pairN.get(pk) || 0; pairN.set(pk, slot + 1);
      const cp = arcControl(A.pos, B.pos, slot, 'flat');
      toScreen(v.cam, W, H, A.pos.x, A.pos.z, a); toScreen(v.cam, W, H, B.pos.x, B.pos.z, b); toScreen(v.cam, W, H, cp.x, cp.z, c);
      const strong = p.level === 'strong', k = Math.max(0, Math.min(1, p.k)) * fxAlpha(A, B); // 프로젝트 페이드
      ctx.save();
      ctx.globalAlpha = (strong ? 0.9 : 0.7) * k;
      ctx.strokeStyle = col;
      ctx.lineWidth = strong ? 3.2 : 1.4;
      if (!strong) ctx.setLineDash([5, 4]);
      if (p.fading) ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke();
      ctx.restore();
      this._geo.push({ p, A: { x: A.pos.x, z: A.pos.z }, B: { x: B.pos.x, z: B.pos.z }, cp, k, strong });
    }
    // 메시지 패킷: 곡선 없이 두 메인 사이 위로 휜 길(편지 봉투 점)
    for (const m of this.msgs) {
      const F = this._vis(m.from), T = this._vis(m.to);
      if (!F || !T) continue;
      const u = Math.min(1, (now - m.t0) / MSG_DUR), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const cp = arcControl(F.pos, T.pos, 1, 'flat');
      const q = bez2(F.pos, cp, T.pos, e);
      toScreen(v.cam, W, H, q.x, q.z, a);
      ctx.save();
      ctx.globalAlpha = (u > 0.85 ? (1 - u) / 0.15 : 1) * fxAlpha(F, T);
      ctx.fillStyle = F.sessC || t['flow-call'];
      ctx.strokeStyle = t.bg;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(a.x - 6, a.y - 4, 12, 8); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x - 6, a.y - 4); ctx.lineTo(a.x, a.y + 1); ctx.lineTo(a.x + 6, a.y - 4); ctx.stroke();
      ctx.restore();
    }
  }

  /** 파일명 칩(노드 위) */
  drawOver(ctx, now) {
    const v = this.view, t = v.tokens, W = v.W, H = v.H;
    const s = {};
    this._chipRects = [];
    for (const g of this._geo || []) {
      const u = 0.5 + 0.36 * Math.sin(now * 0.8 + (g.p.id.length % 7));
      const q = bez2(g.A, g.cp, g.B, u);
      toScreen(v.cam, W, H, q.x, q.z, s);
      const txt = '⚠ ' + pairChipText(g.p);
      ctx.save();
      ctx.font = '600 11px "Pretendard","Segoe UI","Malgun Gothic",sans-serif';
      const w = Math.ceil(ctx.measureText(txt).width) + 14, h = 18;
      const x0 = s.x - w / 2;
      let y0 = s.y - h / 2;
      // 칩끼리 겹치면 아래로 비킴(3D session-fx 와 같은 규칙)
      for (let g2 = 0; g2 < 6 && this._chipRects.some((r) => x0 < r[2] && x0 + w > r[0] && y0 < r[3] + 2 && y0 + h + 2 > r[1]); g2++) y0 += h + 2;
      s.y = y0 + h / 2;
      ctx.globalAlpha = g.k;
      ctx.fillStyle = t.isLight ? 'rgba(255,255,255,.92)' : 'rgba(20,24,34,.9)';
      ctx.strokeStyle = t.conflict || '#ff9a3c';
      ctx.lineWidth = g.strong ? 2 : 1;
      if (g.p.fading) ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y0, w, h, 9) : ctx.rect(x0, y0, w, h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(txt, s.x, s.y + 0.5);
      ctx.restore();
      this._chipRects.push([x0, y0, x0 + w, y0 + h]);
    }
  }

  /** 라벨이 피할 칩 상자 */
  rects(out = []) { for (const r of this._chipRects) out.push(r); return out; }
}
