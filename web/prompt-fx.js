// 사용자 입력 빛줄기 — 화면 공간 오버레이 캔버스 하나(표현 컨테이너 위, 클릭 통과). 흐름·Planet·복셀 3D 와 2D 가 같이 쓴다.
// 규칙은 missile-core.mjs(순수). 표현은 목표의 화면 좌표만 알려 준다(targetFn → {x, y, behind} | null, 컨테이너 기준 px).
// 그리기: ① 모임 — 테두리 한 변을 스치는 옅은 섬광 + 가장자리를 따라 흘러 모이는 가닥 + 밝아지는 점 ② 발사 — 화면 px 폭이 일정한
// 꼬리(한 덩어리 채움 다각형 + 머리 쪽으로 진해지는 그라데이션 — 마디·계단 없음) + 빛나는 머리 ③ 흡수 — 꼬리가 목표로 빨려 들어가고 고리.
// 다크 = 'lighter'(가산), 라이트 = 보통 합성·진한 메인 색(원칙). 활성일 때만 자기 rAF 를 돈다(없으면 0 비용).
import { CHARGE, ABSORB, ABSORB_FROM, MISSILE_REDUCED, TRAIL, flightDur, flightEase, bez, trailAt, pickBorder, flightCurve, edgeClamp } from './missile-core.mjs';

const MAX = 6;
const now = () => performance.now() / 1000;
function hexRgb(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  const n = m ? parseInt(m[1], 16) : 0x60a5fa;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, k) => a.map((v, i) => Math.round(v * (1 - k) + b[i] * k));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export class PromptFx {
  constructor(container) {
    this.container = container;
    const c = this.canvas = document.createElement('canvas');
    c.className = 'prompt-fx';
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '6' });
    container.appendChild(c);
    this.ctx = c.getContext('2d');
    this.list = [];
    this._raf = 0; this._side = 1; this._edge = null;
    this._tick = () => { this._raf = 0; this._frame(); };
  }
  get active() { return this.list.length > 0; }
  /**
   * o = { targetFn, color(#hex), light, reduced, delay(초), onArrive(), onLaunch() }
   * 반환 {start, launch, arrive}(지금부터 초) — 효과음이 같은 박자를 쓴다
   */
  launch(o) {
    const W = this.container.clientWidth || 1, H = this.container.clientHeight || 1;
    if (this.list.length >= MAX) this.list.shift();
    const t0 = now() + Math.max(0, o.delay || 0);
    const T = this._target(o.targetFn, W, H) || { x: W / 2, y: H / 2, on: true };
    this._side = -this._side;
    const m = { o, t0, W, H, side: this._side, arrived: false, launched: false };
    if (o.reduced) {
      m.charge = 0; m.fly = MISSILE_REDUCED.dur;
    } else {
      m.g = pickBorder(W, H, T.x, T.y, Math.random, this._edge); this._edge = m.g.edge;
      m.curve = flightCurve(m.g, T, this._side);
      m.charge = CHARGE.dur; m.fly = flightDur(m.curve.L);
      m.strands = Array.from({ length: CHARGE.strands }, (_, i) => ({ s: (i / (CHARGE.strands - 1)) * 2 - 1 + (Math.random() - 0.5) * 0.12, d: Math.random() * 0.25, w: 0.7 + Math.random() * 0.8 }));
    }
    const base = hexRgb(o.color);
    m.col = o.light ? mix(base, [0, 0, 0], 0.18) : mix(base, [255, 255, 255], 0.4);
    m.core = o.light ? mix(base, [0, 0, 0], 0.35) : [255, 255, 255];
    this.list.push(m);
    this._kick();
    const d = Math.max(0, o.delay || 0);
    return { start: d, launch: d + m.charge, arrive: d + m.charge + m.fly };
  }
  _target(fn, W, H) {
    const p = fn && fn();
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return edgeClamp(W, H, p.x, p.y, 14, !!p.behind);
  }
  _kick() { if (!this._raf && this.list.length) this._raf = requestAnimationFrame(this._tick); }
  _size() {
    const c = this.canvas, W = this.container.clientWidth || 1, H = this.container.clientHeight || 1, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [W, H];
  }
  _frame() {
    const [W, H] = this._size(), ctx = this.ctx, t = now();
    ctx.clearRect(0, 0, W, H);
    const keep = [];
    for (const m of this.list) if (this._draw(ctx, m, t, W, H)) keep.push(m);
    this.list = keep;
    if (keep.length) this._kick(); else ctx.clearRect(0, 0, W, H);
  }
  /** 한 발 그리기. 끝났으면 false */
  _draw(ctx, m, t, W, H) {
    const el = t - m.t0;
    if (el < 0) return true; // 카메라가 옮겨 가는 중(지연)
    const L = !!m.o.light;
    ctx.save();
    ctx.globalCompositeOperation = L ? 'source-over' : 'lighter';
    // 목표(매 프레임 추적) — 화면 밖이면 가장자리 점
    const T = this._target(m.o.targetFn, W, H) || m.lastT || { x: W / 2, y: H / 2, on: true };
    m.lastT = T;
    if (el < m.charge) { this._charge(ctx, m, el / m.charge, L, W, H); ctx.restore(); return true; }
    if (!m.launched) { m.launched = true; if (m.o.onLaunch) m.o.onLaunch(); }
    const kf = (el - m.charge) / m.fly;
    // 곡선(목표 따라 끝점·둘째 제어점 이동)
    let p0, c1, c2;
    if (m.o.reduced) {
      const ax = T.x, ay = T.y + MISSILE_REDUCED.len;
      p0 = { x: ax, y: ay }; c1 = p0; c2 = { x: T.x, y: T.y };
    } else { p0 = m.curve.p0; c1 = m.curve.c1; c2 = { x: T.x + m.curve.off2.x, y: T.y + m.curve.off2.y }; }
    const p1 = { x: T.x, y: T.y };
    const tt = flightEase(Math.min(1, kf));
    const ab = kf > 1 ? Math.min(1, (kf - 1) * m.fly / ABSORB.dur) : 0; // 흡수 진행
    if (kf >= 1 && !m.arrived) { m.arrived = true; m.arriveOn = T.on; if (m.o.onArrive) m.o.onArrive(T.on); }
    // 꼬리: 흡수 중엔 꼬리 끝이 머리(=목표) 쪽으로 빨려 들어감
    const offFade = T.on ? 1 : Math.max(0, Math.min(1, (1 - kf) / 0.25)); // 화면 밖 목표: 가장자리 닿기 전에 사라짐
    this._trail(ctx, m, p0, c1, c2, p1, tt, ab, L, offFade);
    // 머리
    if (kf <= 1) {
      const hp = bez({}, p0, c1, c2, p1, tt);
      const shrink = kf < ABSORB_FROM ? 1 : Math.max(0.25, 1 - (kf - ABSORB_FROM) / (1 - ABSORB_FROM) * 0.75);
      this._head(ctx, m, hp.x, hp.y, (m.o.reduced ? 7 : 10) * shrink, (L ? 0.95 : 1) * offFade);
    }
    // 도착: 화면 안이면 고리, 밖이면 가장자리 쐐기 표시
    if (ab > 0) {
      if (m.arriveOn) {
        const r = 6 + ABSORB.ring * (1 - Math.pow(1 - ab, 2));
        ctx.globalAlpha = 1; ctx.strokeStyle = rgba(m.col, (L ? 0.75 : 0.85) * (1 - ab)); ctx.lineWidth = 2 * (1 - ab) + 0.6;
        ctx.beginPath(); ctx.arc(T.x, T.y, r, 0, Math.PI * 2); ctx.stroke();
      } else this._edgeMark(ctx, m, T, W, H, 1 - ab, L);
    }
    ctx.restore();
    return ab < 1;
  }
  /** 모임: 변을 스치는 섬광 + 가장자리를 따라 흘러 모이는 가닥 + 밝아지는 점 */
  _charge(ctx, m, k, L, W, H) {
    const g = m.g, e = k * k * (3 - 2 * k);
    // 비네트 섬광(그 변 쪽만 옅게)
    const fl = Math.sin(Math.PI * Math.min(1, k * 1.15));
    const rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, 260);
    rg.addColorStop(0, rgba(m.col, (L ? 0.16 : 0.22) * fl)); rg.addColorStop(1, rgba(m.col, 0));
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    // 가닥: 변을 따라 흘러 모임(각자 조금씩 늦게 출발, 안쪽으로 살짝 들어오며)
    ctx.lineCap = 'round';
    for (const s of m.strands) {
      const kk = Math.max(0, Math.min(1, (k - s.d) / (1 - s.d))), ee = kk * kk;
      const along = s.s * CHARGE.spread * (1 - ee), along2 = s.s * CHARGE.spread * (1 - Math.max(0, ee - 0.12));
      const inn = CHARGE.inset * ee, inn2 = CHARGE.inset * Math.max(0, ee - 0.1);
      const x1 = g.x + g.tx * along + g.nx * inn, y1 = g.y + g.ty * along + g.ny * inn;
      const x0 = g.x + g.tx * along2 + g.nx * inn2, y0 = g.y + g.ty * along2 + g.ny * inn2;
      ctx.strokeStyle = rgba(m.col, (L ? 0.7 : 0.8) * Math.min(1, kk * 2.2) * (1 - 0.3 * ee)); ctx.lineWidth = 1.3 * s.w;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // 모인 점
    this._head(ctx, m, g.gx, g.gy, 3 + 7 * e, 0.4 + 0.6 * e);
  }
  _head(ctx, m, x, y, r, a) {
    const L = !!m.o.light;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    g.addColorStop(0, rgba(m.core, a)); g.addColorStop(0.22, rgba(m.core, a * 0.95)); g.addColorStop(0.45, rgba(m.col, a * (L ? 0.55 : 0.6))); g.addColorStop(1, rgba(m.col, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
  }
  /** 꼬리: 화면 px 폭이 일정한 한 덩어리 다각형(머리 TRAIL.W → 끝 0), 꼬리 끝 → 머리로 진해지는 그라데이션. 다크는 넓고 옅은 번짐 한 겹 더 */
  _trail(ctx, m, p0, c1, c2, p1, t, ab, L, fade) {
    const N = TRAIL.N, pts = [], q = {};
    const span = m.o.reduced ? 1 : TRAIL.SPAN;
    const tail0 = ab > 0 ? t * (1 - Math.pow(1 - ab, 2)) : 0;
    for (let i = 0; i < N; i++) { const s = trailAt(t, i, N, span, tail0); bez(q, p0, c1, c2, p1, s.t); pts.push({ x: q.x, y: q.y, w: s.w }); }
    const len = pts.reduce((a, p, i) => a + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
    if (len < 1.5) return;
    const poly = (wk) => {
      ctx.beginPath();
      const side = [];
      for (let i = 0; i < N; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
        let nx = -(b.y - a.y), ny = b.x - a.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const w = (TRAIL.W * wk * pts[i].w) / 2;
        side.push([pts[i].x + nx * w, pts[i].y + ny * w, pts[i].x - nx * w, pts[i].y - ny * w]);
      }
      ctx.moveTo(side[0][0], side[0][1]);
      for (let i = 1; i < N; i++) ctx.lineTo(side[i][0], side[i][1]);
      for (let i = N - 1; i >= 0; i--) ctx.lineTo(side[i][2], side[i][3]);
      ctx.closePath();
    };
    const h = pts[0], e = pts[N - 1];
    const grad = (a) => { const g = ctx.createLinearGradient(e.x, e.y, h.x, h.y); g.addColorStop(0, rgba(m.col, 0)); g.addColorStop(0.55, rgba(m.col, a * 0.45)); g.addColorStop(1, rgba(m.col, a)); return g; };
    const A = (L ? 0.9 : 0.95) * fade * (1 - ab * 0.6);
    ctx.globalAlpha = 1;
    if (!L) { ctx.fillStyle = grad(A * 0.22); poly(3.6); ctx.fill(); } // 번짐
    ctx.fillStyle = grad(A); poly(m.o.reduced ? 0.7 : 1); ctx.fill();
    // 머리 쪽 가는 핵(다크 흰빛, 라이트 진한 색)
    const cg = ctx.createLinearGradient(e.x, e.y, h.x, h.y); cg.addColorStop(0.4, rgba(m.core, 0)); cg.addColorStop(1, rgba(m.core, A * 0.9));
    ctx.fillStyle = cg; poly(0.38); ctx.fill();
  }
  /** 메인이 화면 밖: 가장자리에 바깥을 가리키는 작은 쐐기 + 옅은 번짐 */
  _edgeMark(ctx, m, T, W, H, a, L) {
    const dx = T.x - W / 2, dy = T.y - H / 2, an = Math.atan2(dy, dx);
    const rg = ctx.createRadialGradient(T.x, T.y, 0, T.x, T.y, 40);
    rg.addColorStop(0, rgba(m.col, (L ? 0.35 : 0.45) * a)); rg.addColorStop(1, rgba(m.col, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(T.x, T.y, 40, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(T.x, T.y); ctx.rotate(an);
    ctx.fillStyle = rgba(m.core, 0.9 * a);
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-6, -7); ctx.lineTo(-3, 0); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  clear() { this.list = []; this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  dispose() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; this.list = []; this.canvas.remove(); }
}
