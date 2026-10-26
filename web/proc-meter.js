// 계기 홀로그램 판 그리기(Planet 3D 스프라이트 텍스처 · Planet 2D drawImage 공용) — three 없음, 캔버스 2D 만.
// 모델은 planet-proc-core.mjs meterModel(레인 보간 값·처리율·최장·과열·진행·ETA). 다시 그릴지는 sig(보이는 글자)와 굴러가는 끝자리로 정한다.
//  · 전체 판: 머리(스크립트 이름 · ✓/✕ · 진행 호 + ETA) + 레인 줄(색 표지 · 열쇠 #회차 · 오도미터 · 단위 / 처리율 · 최장 · 과열 막대)
//  · 먼 LOD: 큰 숫자 하나(주 레인)의 알약
import { heatTip, laneColor } from './planet-proc-core.mjs';

const TAU = Math.PI * 2;
export const METER = { W: 300, ROW_H: 46, HEAD_H: 24, FOOT_H: 12, COMPACT_H: 42, ROLL_FROM: 0.7 };

function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function fit(x, s, w) { if (x.measureText(s).width <= w) return s; let t = s; while (t.length > 1 && x.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
/** 굴러가는 몫: 한 자리 시간의 앞 ROLL_FROM 동안은 멈춰 있다가 끝에서 빠르게 다음 숫자로(읽히게) */
export const rollK = (frac) => { const f = (frac - METER.ROLL_FROM) / (1 - METER.ROLL_FROM); if (!(f > 0)) return 0; const k = Math.min(1, f); return k * k * (3 - 2 * k); };
/** 오도미터: 마지막 숫자 칸만 위로 굴러감(다음 숫자가 아래에서 올라옴) — 나머지 자리는 그대로 */
function odometer(x, text, frac, X, Y, color, lh) {
  x.fillStyle = color; x.textAlign = 'left'; x.textBaseline = 'middle';
  const sep = text.indexOf(' / ');
  const end = (sep >= 0 ? text.slice(0, sep) : text).search(/\d(?!.*\d)/);
  const k = rollK(frac);
  if (end < 0 || k <= 0) { x.fillText(text, X, Y); return; }
  const head = text.slice(0, end), d = Number(text[end]), tail = text.slice(end + 1);
  x.fillText(head, X, Y);
  const hx = X + x.measureText(head).width, dw = x.measureText('0').width;
  x.save(); x.beginPath(); x.rect(hx - 1, Y - lh / 2, dw + 2, lh); x.clip();
  x.fillText(String(d), hx, Y - k * lh); x.fillText(String((d + 1) % 10), hx, Y + (1 - k) * lh);
  x.restore();
  x.fillText(tail, hx + dw, Y);
}

export class MeterCanvas {
  constructor() { this.canvas = document.createElement('canvas'); this.canvas.width = METER.W; this.canvas.height = METER.COMPACT_H; this.sig = ''; this.at = -1e9; }
  /** 캔버스 크기 맞추기 → 바뀌었으면 true(3D 는 텍스처를 새로) */
  _size(w, h) { const c = this.canvas; if (c.width === w && c.height === h) return false; c.width = w; c.height = h; return true; }
  /** 굴러가는 끝자리가 있는가(그동안 자주 다시 그림) */
  static rolling(m) { return !!m && !m.ended && m.rows.some((r) => rollK(r.frac) > 0); }
  /**
   * 그리기. o = { model, light, flash(0..1), name, compact, big, ok, err(CSS 색) }. 크기가 바뀌었으면 true 를 돌려준다.
   */
  draw(o) {
    return o.compact ? this._compact(o) : this._full(o);
  }
  _pal(m, L, o) {
    const accent = m.state === 'done' ? o.ok : m.state === 'failed' ? o.err : null;
    return {
      bg: L ? 'rgba(255,255,255,0.88)' : 'rgba(6,14,24,0.74)', edge: accent || (L ? 'rgba(30,41,59,0.55)' : 'rgba(148,197,255,0.55)'),
      text: L ? '#0f172a' : '#e6f0ff', dim: L ? 'rgba(15,23,42,0.62)' : 'rgba(214,228,255,0.64)', accent,
      scan: L ? 'rgba(15,23,42,0.05)' : 'rgba(160,210,255,0.07)', track: L ? 'rgba(15,23,42,0.13)' : 'rgba(255,255,255,0.13)',
    };
  }
  _compact(o) {
    const m = o.model, L = o.light, c = this.canvas, x = c.getContext('2d');
    x.font = '700 30px ui-monospace, Consolas, monospace';
    const w = Math.max(80, Math.ceil(x.measureText(o.big).width) + 30);
    const resized = this._size(w, METER.COMPACT_H);
    const P = this._pal(m, L, o);
    x.clearRect(0, 0, c.width, c.height);
    rr(x, 1, 1, c.width - 2, c.height - 2, 8); x.fillStyle = P.bg; x.fill(); x.lineWidth = 2; x.strokeStyle = P.accent || laneColor(0, L); x.stroke();
    x.font = '700 30px ui-monospace, Consolas, monospace'; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillStyle = P.accent || P.text; x.fillText(o.big, c.width / 2, c.height / 2 + 1);
    return resized;
  }
  _full(o) {
    const m = o.model, L = o.light, c = this.canvas, x = c.getContext('2d');
    const { W: MW, ROW_H, HEAD_H, FOOT_H } = METER;
    const rows = Math.max(1, m.rows.length);
    const resized = this._size(MW, HEAD_H + rows * ROW_H + FOOT_H);
    const P = this._pal(m, L, o), W = c.width, H = c.height;
    x.clearRect(0, 0, W, H);
    rr(x, 1.5, 1.5, W - 3, H - 3, 9); x.fillStyle = P.bg; x.fill();
    for (let y = 4; y < H; y += 4) { x.fillStyle = P.scan; x.fillRect(4, y, W - 8, 1); } // 홀로그램 스캔라인
    x.lineWidth = 2; x.strokeStyle = P.edge; rr(x, 1.5, 1.5, W - 3, H - 3, 9); x.stroke();
    // 머리: ✓/✕ + 스크립트 이름 · 진행 호 + ETA
    x.textBaseline = 'middle'; x.textAlign = 'left';
    x.font = '600 13px ui-sans-serif, system-ui, sans-serif'; x.fillStyle = P.accent || P.dim;
    const head = (m.state === 'done' ? '✓ ' : m.state === 'failed' ? '✕ ' : '') + (o.name || '');
    x.fillText(fit(x, head, W - 128), 12, HEAD_H / 2 + 2);
    x.textAlign = 'right';
    let rx = W - 12;
    if (m.ratio != null) {
      const cx = W - 18, cy = HEAD_H / 2 + 2, r = 7;
      x.lineWidth = 3; x.strokeStyle = P.track; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke();
      x.strokeStyle = laneColor(0, L); x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * m.ratio); x.stroke();
      rx = cx - 14;
    }
    if (m.eta) { x.font = '600 12px ui-monospace, Consolas, monospace'; x.fillStyle = P.dim; x.fillText('ETA ' + m.eta, rx, HEAD_H / 2 + 2); rx -= x.measureText('ETA ' + m.eta).width + 8; }
    if (o.flash > 0) { // 진행 들여다보기 결과가 막 옴 → 체크
      x.globalAlpha = Math.min(1, o.flash * 1.6); x.fillStyle = o.ok; x.font = '700 16px ui-sans-serif, system-ui, sans-serif';
      x.fillText('✓', rx, HEAD_H / 2 + 2); x.globalAlpha = 1;
    }
    // 레인 줄
    m.rows.forEach((r, i) => {
      const y0 = HEAD_H + i * ROW_H;
      x.fillStyle = r.color; x.fillRect(10, y0 + 6, 4, ROW_H - 12);
      x.textAlign = 'left'; x.font = '600 11px ui-monospace, Consolas, monospace'; x.fillStyle = P.dim;
      x.fillText(fit(x, r.key + (r.pass > 1 ? ' #' + r.pass : ''), 140), 20, y0 + 11);
      x.font = '700 24px ui-monospace, Consolas, monospace';
      odometer(x, r.text, r.frac, 20, y0 + 31, P.accent || P.text, 20);
      const tw = x.measureText(r.text).width;
      if (r.unit) { x.font = '500 11px ui-sans-serif, system-ui, sans-serif'; x.fillStyle = P.dim; x.fillText(fit(x, r.unit, 50), 24 + tw, y0 + 35); }
      x.textAlign = 'right'; x.font = '600 12px ui-monospace, Consolas, monospace'; x.fillStyle = P.text;
      if (r.rate) x.fillText(r.rate, W - 12, y0 + 13);
      if (r.last) { x.font = '500 10px ui-monospace, Consolas, monospace'; x.fillStyle = P.dim; x.fillText(r.last, W - 12, y0 + 27); }
      // 그 레인 과열 막대: 호박 → 주홍
      const ht = heatTip(r.heat, L), bw = 64, bx = W - 12 - bw, by = y0 + ROW_H - 10;
      x.fillStyle = P.track; x.fillRect(bx, by, bw, 3);
      x.fillStyle = `rgb(${(ht.r * 255) | 0},${(ht.g * 255) | 0},${(ht.b * 255) | 0})`; x.fillRect(bx, by, Math.max(2, bw * r.heat), 3);
    });
    return resized;
  }
}
