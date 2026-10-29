// 복셀 바닥 스텐실 글자 그림 — 3D(vx-stencil.js)·2D(flat/voxel2d.js) 공용. three 없음(2D 정적 import 규칙).
// 캔버스에 흰 글자 마스크를 한 번 그려 캐시(글이 바뀔 때만 다시). 3D 는 이 캔버스를 텍스처로 쓰고 재질 색을 곱하고,
// 2D 는 색을 입힌 사본(색마다 캐시)을 drawImage 한다.
//   스텐실 모양: 굵은 글꼴 + 속이 빈 글자(O·A·B…)의 가운데 세로 틈(다리) + 글자 사이 넓게,
//   닳은 페인트: 이름 시드 난수로 작은 벗겨짐 점·긁힌 줄·옅은 얼룩(destination-out) — 같은 이름이면 늘 같은 무늬.
import { BRIDGE_CHARS, STENCIL, stencilSeed, mulberry32 } from './stencil-core.mjs';

const PX = 112;                 // 글자 크기(캔버스 px)
const PAD = Math.round(PX * 0.22);
const TRACK = 0.1;              // 글자 사이(글자 크기 비율)
const FONT = `900 ${PX}px "Arial Black", "Segoe UI Black", Impact, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
const MAX_W = 4096;
const cache = new Map();        // key(lines) → { canvas, aspect, tinted: Map(color → canvas) }
const CACHE_MAX = 48;

function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/** 줄 배열 → { canvas(흰 마스크), aspect(폭/높이 — 글 덩어리 기준) } (캐시) */
export function stencilMask(lines) {
  const key = lines.join('\n');
  let e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); return e; } // 최근 사용 순
  const probe = mkCanvas(8, 8).getContext('2d');
  probe.font = FONT;
  const lw = lines.map((l) => [...l].reduce((s, ch) => s + probe.measureText(ch).width, 0) + Math.max(0, [...l].length - 1) * PX * TRACK);
  const maxW = Math.max(...lw);
  const k = maxW + 2 * PAD > MAX_W ? (MAX_W - 2 * PAD) / maxW : 1;
  const lineH = PX * 1.0, gap = PX * STENCIL.LINE_GAP;
  const textH = lines.length * lineH + (lines.length - 1) * gap;
  const W = Math.ceil(maxW * k + 2 * PAD), H = Math.ceil(textH * k + 2 * PAD);
  const cv = mkCanvas(W, H);
  const g = cv.getContext('2d');
  g.setTransform(k, 0, 0, k, PAD, PAD);
  g.font = FONT; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#fff';
  const rnd = mulberry32(stencilSeed(key));
  lines.forEach((l, li) => {
    const cy = li * (lineH + gap) + lineH / 2;
    let x = (maxW - lw[li]) / 2;
    for (const ch of l) {
      const cw = probe.measureText(ch).width;
      g.globalCompositeOperation = 'source-over';
      g.shadowColor = 'rgba(255,255,255,0.55)'; g.shadowBlur = PX * 0.05; // 뿌린 페인트 번짐(가장자리)
      g.fillText(ch, x, cy);
      g.shadowBlur = 0;
      // 스텐실 다리: 가운데 세로 틈(위·아래 모두 끊김) — 글자 높이 전체
      if (BRIDGE_CHARS.has(ch)) {
        g.globalCompositeOperation = 'destination-out';
        const bw = PX * 0.075;
        g.fillRect(x + cw / 2 - bw / 2, cy - lineH * 0.62, bw, lineH * 1.24);
      }
      x += cw + PX * TRACK;
    }
  });
  // 닳은 페인트(이름 시드)
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  const area = W * H;
  for (let i = 0, n = Math.round(area / 650); i < n; i++) { // 작은 벗겨짐 점
    g.globalAlpha = 0.35 + rnd() * 0.65;
    const r = 0.6 + rnd() * rnd() * 4.2;
    g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2); g.fill();
  }
  g.lineCap = 'round';
  for (let i = 0, n = 4 + Math.round(area / 60000); i < n; i++) { // 긁힌 줄(대각선 가까이)
    g.globalAlpha = 0.45 + rnd() * 0.45; g.lineWidth = 0.8 + rnd() * 1.8;
    const x = rnd() * W, y = rnd() * H, a = (rnd() - 0.5) * 0.9 + (rnd() < 0.5 ? 0 : Math.PI / 2.4), L = PX * (0.4 + rnd() * 1.6);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  for (let i = 0, n = 3 + Math.round(area / 90000); i < n; i++) { // 옅은 얼룩(바랜 자리)
    const x = rnd() * W, y = rnd() * H, r = PX * (0.5 + rnd() * 1.4);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,' + (0.25 + rnd() * 0.3).toFixed(2) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  e = { canvas: cv, aspect: (maxW * k + 2 * PAD) / (textH * k + 2 * PAD), padX: PAD / W, padY: PAD / H, tinted: new Map(), key };
  cache.set(key, e);
  while (cache.size > CACHE_MAX) { const old = cache.keys().next().value; const o = cache.get(old); cache.delete(old); if (o && o.onEvict) o.onEvict(); }
  return e;
}

/** 2D: 색을 입힌 사본(색마다 캐시) */
export function stencilTinted(lines, color) {
  const e = stencilMask(lines);
  let c = e.tinted.get(color);
  if (c) return { canvas: c, aspect: e.aspect, padX: e.padX, padY: e.padY };
  c = mkCanvas(e.canvas.width, e.canvas.height);
  const g = c.getContext('2d');
  g.drawImage(e.canvas, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  e.tinted.set(color, c);
  if (e.tinted.size > 4) e.tinted.delete(e.tinted.keys().next().value);
  return { canvas: c, aspect: e.aspect, padX: e.padX, padY: e.padY };
}
