// 2D(저사양) 신호 열화 — 3D 셰이더(noise.js)와 같은 은유를 캔버스 2D 로, 장면을 다 그린 뒤 같은 캔버스 위에 덧그린다.
//   그레인(미리 만든 128px 잡음 무늬) · 주사선(3px 무늬) · 색 바램(saturation 합성) · 가로 찢김(캔버스 띠를 자기 자신에 옆으로 복사)
//   · 데이터모시(24px 블록 복사). 복사 원본은 재사용 스크래치 캔버스 — 2D 캔버스(desynchronized)는 자기 자신을 drawImage 원본으로 쓰면
//     그 프레임에 그린 것이 통째로 사라졌다(헤드리스 Edge 실측), 그래서 장면을 스크래치에 한 번 복사해 거기서 가져온다 · 비네팅(단일 세션) · 메인 노드 잔상/윤곽 이중화(노드 둘레를 0.2초 늦은 흔들림만큼 비켜 반투명 복사)
//   · 문턱 버스트(찢김·반전 띠 0.5초) · 정화 앞머리 빛 띠.
// 무늬·그라데이션은 한 번 만들어 재사용(프레임마다 객체 생성 없음). 대상이 없으면 level 0 → 2D 루프가 예전처럼 쉰다(비용 0).
import { toScreen, camScale } from './flat-core.mjs';
import { DEG, hash2, ghostOffsets, seedOf, grainAmp } from '../degrade-core.mjs';
import { smoothstep, GRAIN_PCT, SCAN_PCT, CHROMA_PCT, MOSH_PCT, TOP_PCT } from '../ctx-core.mjs';
const G = GRAIN_PCT / 100, S = SCAN_PCT / 100, C = CHROMA_PCT / 100, M = MOSH_PCT / 100, T = TOP_PCT / 100; // 단계 경계(셰이더와 같음)

let grainCv = null, scanCv = null;
// 부호 있는 잡음: 양수 = 흰 점, 음수 = 검은 점, 크기 = 알파 → 어두운 화소엔 흰 점이, 밝은 화소엔 검은 점이 보인다(밝기 의존)
function grainCanvas() {
  if (grainCv) return grainCv;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), im = x.createImageData(128, 128);
  let s = 2027;
  for (let i = 0; i < im.data.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const n = (s >>> 16) / 32768 - 1;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const tint = ((s >>> 24) - 128) * 0.18; // 옅은 색 입자
    const v = n > 0 ? 255 : 0;
    im.data[i] = Math.max(0, Math.min(255, v + tint)); im.data[i + 1] = v; im.data[i + 2] = Math.max(0, Math.min(255, v - tint)); im.data[i + 3] = Math.round(Math.abs(n) * 255);
  }
  x.putImageData(im, 0, 0);
  return (grainCv = c);
}
function scanCanvas() {
  if (scanCv) return scanCv;
  // 어두운 줄 + 밝은 줄(overlay 로 그려 평균 밝기를 크게 깎지 않음)
  const c = document.createElement('canvas'); c.width = 4; c.height = 3;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 4, 1); x.fillStyle = '#fff'; x.fillRect(0, 2, 4, 1);
  return (scanCv = c);
}

export class FlatDegrade {
  constructor() {
    this.regions = [];   // [{key, c:{x,z}|null, r(세계), L, burstKey, purge:{p, oldL}|null}] — ctx-ui 가 4Hz 로 채움
    this.mains = [];     // [{id, D}]
    this.full = true;
    this.amp = 1; this.ampG = 1; this.motion = 1;
    this.getBurst = () => 0;
    this.level = 0;      // 2D 루프에 알리는 움직임 단계(0 쉼 · 1 15fps · 2 30fps)
    this.draws = 0;
    this._pat = null; this._scanPat = null; this._patCtx = null;
    this._vig = null; this._vigKey = '';
    this._sp = { x: 0, y: 0 }; this._go = { ax: 0, ay: 0, bx: 0, by: 0, stutter: false };
    this._scr = null; this._scrCtx = null; // 복사 원본(재사용)
  }

  /** 지금 무엇이든 그릴 게 있나 */
  get active() { return this.regions.length > 0 || this.mains.length > 0; }

  draw(view, ctx, now) {
    if (!this.active) return;
    const cv = view.canvas, dpr = view.dpr || 1;
    const BW = cv.width, BH = cv.height;
    if (this._patCtx !== ctx) { this._patCtx = ctx; this._pat = ctx.createPattern(grainCanvas(), 'repeat'); this._scanPat = ctx.createPattern(scanCanvas(), 'repeat'); }
    const t = DEG.t, mot = this.motion;
    // 복사 원본: 장면을 스크래치에 한 번(크기가 바뀔 때만 새로 만듦)
    if (!this._scr) { this._scr = document.createElement('canvas'); this._scrCtx = this._scr.getContext('2d', { alpha: false }); }
    if (this._scr.width !== BW || this._scr.height !== BH) { this._scr.width = BW; this._scr.height = BH; }
    this._scrCtx.drawImage(cv, 0, 0);
    const src = this._scr;
    const nowMs = now * 1000;
    const s = camScale(view.cam, view.H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // 버퍼 px 로 작업(자기 복사 좌표가 같게)
    // ---- 영역별(단일 세션 = 화면 전체 하나) ----
    for (const R of this.regions) {
      let cx = BW / 2, cy = BH / 2, rad = Math.hypot(BW, BH);
      if (!this.full) {
        if (!R.c) continue;
        toScreen(view.cam, view.W, view.H, R.c.x, R.c.z, this._sp);
        cx = this._sp.x * dpr; cy = this._sp.y * dpr; rad = Math.max(70 * dpr, R.r * s * dpr * 1.1);
        if (cx + rad < 0 || cy + rad < 0 || cx - rad > BW || cy - rad > BH) continue;
      }
      let L = R.L;
      if (R.purge) L = R.purge.oldL; // 정화 중: 앞머리 오른쪽은 이전 값(앞머리 왼쪽은 아래에서 새 값으로 덮지 않고 빛 띠만)
      const bu = this.getBurst(R.burstKey, nowMs);
      const g = smoothstep(G, S, L) * this.ampG, sc = smoothstep(S, C, L) * this.amp;
      const ch = Math.max(smoothstep(C, M, L) * this.amp, bu * 1.6), mo = Math.max(smoothstep(M, T, L) * Math.min(this.amp, 1.5), bu * 0.9);
      if (grainAmp(L) / 30 + sc + ch + mo < 0.01 && !R.purge) continue;
      ctx.save();
      if (!this.full) { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip(); }
      const x0 = this.full ? 0 : Math.max(0, cx - rad), y0 = this.full ? 0 : Math.max(0, cy - rad);
      const x1 = this.full ? BW : Math.min(BW, cx + rad), y1 = this.full ? BH : Math.min(BH, cy + rad);
      const w = x1 - x0, h = y1 - y0;
      if (w < 2 || h < 2) { ctx.restore(); continue; }
      // 가로 찢김(색수차 단계부터, 버스트 중엔 많이): 띠를 옆으로 밀어 자기 자신에 복사
      if (ch > 0.01 && mot) {
        const slot = Math.floor(t * 4), on = hash2(slot, 7) > 0.8 || bu > 0.01;
        if (on) {
          const fr = Math.floor(t * 20), rows = bu > 0.01 ? 14 : 5, rh = Math.max(4, Math.round((bu > 0.01 ? 11 : 7) * dpr));
          for (let i = 0; i < rows; i++) {
            const yy = y0 + Math.floor(hash2(fr, i * 3 + 1) * (h - rh));
            const dx = Math.round((hash2(fr, i * 3 + 2) - 0.5) * BW * (0.06 * ch + 0.1 * bu));
            if (dx) ctx.drawImage(src, x0, yy, w, rh, x0 + dx, yy, w, rh);
          }
        }
      }
      // 데이터모시: 24px 블록을 옆 블록에서 끌어옴
      if (mo > 0.01) {
        const B = Math.round(24 * dpr), n = Math.round(mo * 0.42 * (w * h) / (B * B) * 0.35), fr = Math.floor((mot ? t : 0) * 1.5 + bu * t * 9);
        for (let i = 0; i < Math.min(n, 160); i++) {
          const bx = x0 + Math.floor(hash2(fr, i * 5 + 1) * (w / B)) * B, by = y0 + Math.floor(hash2(fr, i * 5 + 2) * (h / B)) * B;
          const sx = bx + Math.round((hash2(fr, i * 5 + 3) - 0.5) * 2 * B), sy = by + Math.round((hash2(fr, i * 5 + 4) - 0.5) * 2 * B);
          ctx.drawImage(src, Math.max(0, Math.min(BW - B, sx)), Math.max(0, Math.min(BH - B, sy)), B, B, bx, by, B, B);
        }
      }
      // 색 바램: 채도 빼기 + 누렇게
      if (sc > 0.01) {
        ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = Math.min(0.9, sc * 0.5); ctx.fillStyle = '#808080'; ctx.fillRect(x0, y0, w, h);
        ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = Math.min(0.5, sc * 0.14); ctx.fillStyle = '#fff2d8'; ctx.fillRect(x0, y0, w, h);
        // 주사선(3px)
        ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = Math.min(0.7, sc * 0.45);
        ctx.fillStyle = this._scanPat; ctx.save(); ctx.translate(0, mot ? Math.floor(t * 3) % 3 : 0); ctx.fillRect(x0, y0 - 3, w, h + 6); ctx.restore();
      }
      // 그레인
      // 그레인: 입자 장치 px max(2, round(dpr×1.5)), 프레임마다(24fps 칸) 무늬 위치를 옮김, 진폭 grainAmp(±10～30/255)
      const ga = grainAmp(L) * this.ampG / 255 + mo * 0.03 + bu * 0.08;
      if (ga > 0.0005) {
        const gs = Math.max(2, Math.round(dpr * 1.5)), fr = mot ? Math.floor(t * 24) : 0;
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, ga * 255 / 150);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = this._pat;
        ctx.save(); ctx.translate(x0 - Math.floor(hash2(fr, 1) * 128) * gs, y0 - Math.floor(hash2(fr, 2) * 128) * gs); ctx.scale(gs, gs);
        ctx.fillRect(0, 0, w / gs + 256, h / gs + 256); ctx.restore();
        ctx.imageSmoothingEnabled = true;
      }
      // 버스트: 반전 띠
      if (bu > 0.01 && mot) {
        ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#ffffff';
        const fr = Math.floor(t * 24), bh = Math.round(18 * dpr);
        for (let yy = y0; yy < y1; yy += bh) if (hash2(Math.floor(yy / bh), fr) > 0.82) { ctx.globalAlpha = bu * 0.75; ctx.fillRect(x0, yy, w, bh); }
      }
      // 비네팅(화면 전체만)
      if (this.full && ch > 0.01) {
        const key = BW + 'x' + BH;
        if (this._vigKey !== key) {
          this._vigKey = key;
          this._vig = ctx.createRadialGradient(BW / 2, BH / 2, Math.hypot(BW, BH) * 0.22, BW / 2, BH / 2, Math.hypot(BW, BH) * 0.66);
          this._vig.addColorStop(0, 'rgba(0,0,0,0)'); this._vig.addColorStop(1, 'rgba(0,0,0,1)');
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(0.8, ch * 0.42); ctx.fillStyle = this._vig; ctx.fillRect(0, 0, BW, BH);
      }
      // 정화 앞머리: 왼쪽 → 오른쪽 빛 띠
      if (R.purge && mot) {
        const px = x0 + w * R.purge.p, bw = Math.max(10, w * 0.035);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 * (1 - R.purge.p); ctx.fillStyle = '#80c8ff';
        ctx.fillRect(px - bw / 2, y0, bw, h);
      }
      ctx.restore();
    }
    // ---- 메인 노드 잔상·윤곽 이중화·끊김 ----
    for (const m of this.mains) {
      const v = view.vis.get(m.id);
      if (!v || v.gone || v.hidden) continue;
      const D = DEG.on ? Math.max(m.D, (DEG.burst.get(DEG.sessOf.get(m.id)) || 0) * 0.9) : 0;
      if (D <= 0.01) continue;
      const pos = v.pos || v.target;
      toScreen(view.cam, view.W, view.H, pos.x, pos.z, this._sp);
      const cx = this._sp.x * dpr, cy = this._sp.y * dpr;
      const rr = Math.max(26 * dpr, Math.min(220 * dpr, (v._R || v.r * s) * dpr * 1.9));
      if (cx + rr < 0 || cy + rr < 0 || cx - rr > BW || cy - rr > BH) continue;
      const go = ghostOffsets(D, mot ? t : 0, m.seed || (m.seed = seedOf(m.id)), DEG.reduced || !mot, this._go);
      const sx = Math.max(0, cx - rr), sy = Math.max(0, cy - rr), sw = Math.min(BW, cx + rr) - sx, sh = Math.min(BH, cy + rr) - sy;
      if (sw < 2 || sh < 2) continue;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.clip();
      // 잔상(0.2초 늦은 흔들림 + 비켜 난 윤곽) — 화면 y 는 아래가 + (셰이더와 반대)
      ctx.globalAlpha = Math.min(0.55, D * 0.55);
      ctx.drawImage(src, sx, sy, sw, sh, sx + go.bx * dpr, sy - go.by * dpr, sw, sh);
      // 본체 흔들림·끊김: 한 번 더 비켜 그려 튀는 것처럼
      if (go.ax || go.ay) { ctx.globalAlpha = go.stutter ? 0.85 : Math.min(0.4, D * 0.4); ctx.drawImage(src, sx, sy, sw, sh, sx + go.ax * dpr, sy - go.ay * dpr, sw, sh); }
      ctx.restore();
    }
    ctx.restore();
    this.draws++;
  }
}
