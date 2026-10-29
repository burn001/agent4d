// Planet 2D 시안 궤도계(— 3D planet-variants.js 의 단순 실루엣판). 같은 시안(variantOfVis — 3D 와 같은 메모·규칙),
// 낮은 앙각(ELEV)으로 비스듬히 내려다본 도형: 뒤쪽(깊이 < 0)은 pass 0(본체 전), 앞쪽은 pass 1(본체 뒤).
// 상태(VAR_STATE)·LOD(variantLod, 본체 px × 1.35)·완료 정리 자세·오류 붉은 맥동·중지 회색은 3D 와 같은 값. 발사점(도구 입자·카드 빔)은 po.sat 에.
import { VAR_STATE, VARIANT_CORE, variantLod, variantMode, approach, hash01, cassetteModel, CASSETTE_N } from '../planet-core.mjs';
import { mixColor } from './flat-core.mjs';
import { ELEV } from './planet-orbits2d.js';

const TAU = Math.PI * 2;
const SE = Math.sin(ELEV), CE = Math.cos(ELEV);
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;
const P = { x: 0, y: 0, d: 0 };
/** 지역 점 (x,y,z) → 기울기(inc: x 축)·방위(yaw: y 축) → 화면(앙각 투영). out 채움 */
function pr(x, y, z, inc, yaw, out = P) {
  const ci = Math.cos(inc), si = Math.sin(inc);
  const y1 = y * ci - z * si, z1 = y * si + z * ci;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
  out.x = x2; out.y = z2 * SE - y1 * CE; out.d = z2 * CE + y1 * SE;
  return out;
}

/** 노드마다 상태(처음 한 번) — 3D 와 같은 시드 값 */
function stateOf(v, name, now, reduced) {
  let s = v._pv2;
  if (!s) s = v._pv2 = { S: { ...VAR_STATE.wait }, ph: hash01(v.id, 'vph') * 20, mt: hash01(v.id, 'vmt') * 30, yaw: hash01(v.id, 'vyaw') * TAU, last: now, rot: 0, curKey: -1, curAt: now, seed: hash01(v.id, 'vd') };
  const dt = Math.min(0.25, Math.max(0, now - s.last)); s.last = now;
  const mode = variantMode(v.node.status, v.icons ? v.icons.size : 0, !!v.scopeRecent);
  approach(s.S, VAR_STATE[mode] || VAR_STATE.wait, dt, 2.5);
  const k = reduced ? 0.15 : 1;
  s.ph += dt * s.S.spd * k; s.mt += dt * k; s.dt = dt;
  return s;
}

function colorsOf(v, col, L) {
  const key = col + L;
  if (v._pv2c && v._pv2c.k === key) return v._pv2c;
  return (v._pv2c = L
    ? { k: key, line: mixColor(col, '#334155', 0.35), lite: mixColor(col, '#1e293b', 0.15), part: mixColor(col, '#475569', 0.45), metal: '#6b7385', dark: mixColor(col, '#1e293b', 0.55), glow: mixColor(col, '#0f172a', 0.25) }
    : { k: key, line: mixColor(col, '#cfe0f2', 0.45), lite: mixColor(col, '#ffffff', 0.4), part: mixColor(col, '#9aa3b5', 0.55), metal: '#a7b0c2', dark: mixColor(col, '#0b1220', 0.5), glow: mixColor(col, '#ffffff', 0.55) });
}

/** 기운 원(반지름 a)의 앞/뒤 토막을 이 pass 만큼 그림. style 0 실선 · 1 점선 · 3 점 */
function ring(ctx, x, y, R, a, inc, yaw, pass, style = 0, n = 48) {
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    pr(Math.cos(t) * a, 0, Math.sin(t) * a, inc, yaw);
    const on = (P.d < 0) === (pass === 0) && (style !== 1 || i % 2 === 0);
    if (!on) { pen = false; continue; }
    if (style === 3) { ctx.rect(x + P.x * R - 0.6, y + P.y * R - 0.6, 1.2, 1.2); continue; }
    if (!pen) { ctx.moveTo(x + P.x * R, y + P.y * R); pen = true; } else ctx.lineTo(x + P.x * R, y + P.y * R);
  }
  if (style === 3) ctx.fill(); else ctx.stroke();
}

/**
 * 시안 그리기. pass 0 = 몸체 전(뒤쪽), 1 = 몸체 뒤(앞쪽). R = 본체 반지름(px, 예전 본체 크기 — 작은 본체는 coreR2d).
 * 반환 없음 — 발사점은 v._po.sat 에 화면 좌표로(pass 1 에서 채움).
 */
export function drawVariant2D(view, ctx, v, name, x, y, R, alpha, now, col, pass) {
  const L = !!view.tokens.isLight, reduced = !!view.reduced, t = view.tokens;
  const st = pass === 0 ? stateOf(v, name, now, reduced) : v._pv2;
  if (!st) return;
  const S = st.S, ph = st.ph, mt = st.mt, yaw = st.yaw;
  const lod = variantLod(R * 1.35);
  const C = colorsOf(v, col, L);
  const tE = ease(S.tidy);
  const pulse = 0.5 + 0.5 * Math.sin(mt * 6);
  const bright = 0.35 + 0.65 * S.bright;
  const red = t.error || '#f87171', green = t.ok || '#86efac';
  const errC = (c) => (S.err > 0.05 ? mixColor(c, red, S.err * (0.4 + 0.5 * pulse)) : c);
  const sats = pass === 1 && v._po ? (v._po.sat.length = 0, v._po.sat) : null;
  const em = (sx, sy) => { if (sats && sats.length < 8) sats.push(sx, sy); };
  const lw = Math.max(0.6, Math.min(1.4, R * 0.045));
  const A = (k) => Math.min(1, alpha * k);
  ctx.lineWidth = lw;
  const back = pass === 0;

  if (name === 'belt') {
    const inc = 0.38, cnt = lod === 0 ? 0 : lod === 1 ? 14 : lod === 2 ? 28 : 44;
    if (!cnt) { ctx.globalAlpha = A(0.4 * bright); ctx.fillStyle = C.line; ring(ctx, x, y, R, 1.85, inc, yaw, pass, 3); return; }
    for (let i = 0; i < cnt; i++) {
      const h = (k) => hash01(v.id, 'b' + i + k);
      const inner = h('i') < 0.42, r0 = inner ? lerp(1.08, 1.42, h('r')) : lerp(1.72, 2.32, h('r'));
      const ore = i % 7 === 0, w = 0.55 * Math.pow(1.6 / r0, 1.5), ang = h('a') * TAU + ph * w;
      const rr = lerp(r0, inner ? 1.45 : 1.85, tE) + (S.err > 0.01 ? Math.sin(mt * 13 + i * 1.7) * 0.07 * S.err : 0);
      pr(Math.cos(ang) * rr, (h('y') - 0.5) * 0.24 * (1 - tE), Math.sin(ang) * rr, inc, yaw);
      if ((P.d < 0) !== back) continue;
      const sx = x + P.x * R, sy = y + P.y * R, sz = Math.max(0.8, R * lerp(0.05 + 0.11 * h('s') * h('s') + (ore ? 0.03 : 0), 0.085, tE * 0.7));
      ctx.globalAlpha = A(back ? 0.6 : 1); ctx.fillStyle = ore ? errC(C.glow) : C.part;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(h('q') * 6 + mt * 0.4 * (1 - tE)); ctx.fillRect(-sz, -sz * 0.75, sz * 2, sz * 1.5); ctx.restore();
      if (ore) em(sx, sy);
    }
  } else if (name === 'crystal') {
    const rings = [{ n: 7, r: 1.35, inc: 0.32, w: 0.5, dir: 1 }, { n: 5, r: 2.0, inc: -0.42, w: 0.32, dir: -1 }];
    if (lod === 0) { ctx.globalAlpha = A(0.35 * bright); ctx.strokeStyle = C.line; ring(ctx, x, y, R, 1.6, 0.32, yaw, pass); return; }
    let i = 0;
    for (const [ri, Rg] of rings.entries()) for (let k = 0; k < Rg.n; k++, i++) {
      const a = (k / Rg.n) * TAU + hash01(v.id, 'c' + i) * 0.3 + ph * Rg.w * Rg.dir;
      const rr = Rg.r + S.act * 0.14 * (0.5 + 0.5 * Math.sin(mt * 5 + i)) - tE * (ri ? 0.35 : 0.2);
      const inc = Rg.inc * (1 - tE);
      pr(Math.cos(a) * rr, 0, Math.sin(a) * rr, inc, yaw + ri * 0.9);
      if ((P.d < 0) !== back) continue;
      const bx = x + P.x * R, by = y + P.y * R, dep = P.d;
      // 파편 = 바깥(완료면 위)을 겨눈 가는 마름모
      pr(Math.cos(a) * (rr + 0.4), 0, Math.sin(a) * (rr + 0.4), inc, yaw + ri * 0.9);
      let dx = x + P.x * R - bx, dy = y + P.y * R - by;
      dx = lerp(dx, 0, tE); dy = lerp(dy, -R * 0.4, tE);
      const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, Lh = R * 0.32 * (1 + 0.25 * S.act) * (0.8 + 0.45 * hash01(v.id, 'cs' + i)), Wd = R * 0.07;
      ctx.globalAlpha = A((back ? 0.55 : 1) * (0.7 + 0.3 * bright)); ctx.fillStyle = errC(C.lite);
      ctx.beginPath(); ctx.moveTo(bx + ux * Lh, by + uy * Lh); ctx.lineTo(bx - uy * Wd, by + ux * Wd); ctx.lineTo(bx - ux * Lh * 0.3, by - uy * Lh * 0.3); ctx.lineTo(bx + uy * Wd, by - ux * Wd); ctx.closePath(); ctx.fill();
      if (i % 4 === 0) em(bx + ux * Lh, by + uy * Lh);
      void dep;
    }
  } else if (name === 'drones') {
    const orbs = [{ r: 1.55, inc: 0.7, yw: yaw, w: 0.9 }, { r: 2.05, inc: -0.55, yw: yaw + 1.1, w: 0.62 }];
    ctx.strokeStyle = C.line; ctx.globalAlpha = A((lod === 0 ? 0.45 : 0.3) * bright * (1 - tE * 0.7));
    for (const o of orbs) ring(ctx, x, y, R, o.r, o.inc, o.yw, pass, 1);
    if (lod === 0) return;
    for (let i = 0; i < 4; i++) {
      const o = orbs[i >> 1], M = ph * o.w + (i % 2) * Math.PI;
      pr(Math.cos(M) * o.r, 0, Math.sin(M) * o.r, o.inc, o.yw);
      const da = (i * Math.PI) / 2 + 0.4; const P0 = { ...P }; pr(Math.cos(da) * 0.6, 0, Math.sin(da) * 0.6, 0, yaw);
      const px = lerp(P0.x, P.x, tE), py = lerp(P0.y, P.y, tE), pd = lerp(P0.d, P.d, tE);
      if ((pd < 0) !== back) continue;
      const sx = x + px * R, sy = y + py * R, s = R * 0.13;
      ctx.globalAlpha = A(back ? 0.6 : 1); ctx.fillStyle = C.metal; ctx.fillRect(sx - s * 0.5, sy - s * 0.3, s, s * 0.6);
      ctx.strokeStyle = C.dark; ctx.lineWidth = Math.max(1, s * 0.25); const ws = s * 1.4 * (1 - 0.55 * tE);
      ctx.beginPath(); ctx.moveTo(sx - s * 0.5 - ws, sy); ctx.lineTo(sx + s * 0.5 + ws, sy); ctx.stroke(); ctx.lineWidth = lw;
      if (lod >= 2) { const on = Math.sin(mt * lerp(0.6, 6, S.act) * TAU + i) > 0 ? 1 : 0.3; ctx.globalAlpha = A(on * (0.4 + 0.6 * bright)); ctx.fillStyle = tE > 0.5 ? green : errC(C.glow); ctx.fillRect(sx - 1, sy - s * 0.3 - 2, 2, 2); }
      em(sx, sy);
    }
  } else if (name === 'station') {
    const K = 1.2, inc = 0.55, spin = ph * 0.38;
    ctx.strokeStyle = lod === 0 ? C.line : C.metal;
    ctx.globalAlpha = A(lod === 0 ? 0.5 * bright : back ? 0.55 : 0.95); ctx.lineWidth = lod === 0 ? lw : Math.max(1, R * 0.05);
    ring(ctx, x, y, R, 1.55 * K, inc, yaw, pass, 0, 64);
    if (lod === 0) return;
    ctx.lineWidth = Math.max(0.6, R * 0.025);
    for (let k = 0; k < 3; k++) { // 바퀴살
      const a = spin + (k * TAU) / 3;
      pr(Math.cos(a) * 1.55 * K, 0, Math.sin(a) * 1.55 * K, inc, yaw); const ex = P.x, ey = P.y, ed = P.d;
      if ((ed < 0) !== back) continue;
      pr(Math.cos(a) * 0.47 * K, 0, Math.sin(a) * 0.47 * K, inc, yaw);
      ctx.beginPath(); ctx.moveTo(x + P.x * R, y + P.y * R); ctx.lineTo(x + ex * R, y + ey * R); ctx.stroke();
    }
    for (let i = 0; i < 12; i++) { // 모듈 + 창 불빛(달리는 빛)
      const a = spin + (i / 12) * TAU;
      pr(Math.cos(a) * 1.55 * K, 0, Math.sin(a) * 1.55 * K, inc, yaw);
      if ((P.d < 0) !== back) continue;
      const sx = x + P.x * R, sy = y + P.y * R, s = Math.max(1, R * 0.08);
      ctx.globalAlpha = A(back ? 0.6 : 1); ctx.fillStyle = C.part; ctx.fillRect(sx - s, sy - s * 0.6, s * 2, s * 1.2);
      if (lod >= 2) {
        const kT = 0.25 + 0.95 * Math.pow(0.5 + 0.5 * Math.cos((i / 12) * TAU - mt * 5), 4), kW = 0.22 + 0.12 * Math.sin(mt * 1.2 + i);
        ctx.globalAlpha = A(lerp(kW, kT, S.act)); ctx.fillStyle = S.err > 0.3 && i % 4 === 1 && pulse > 0.5 ? red : tE > 0.5 ? green : C.glow;
        ctx.fillRect(sx - s * 0.6, sy - s * 0.25, s * 1.2, s * 0.5);
      }
      if (i % 4 === 0) em(sx, sy);
    }
  } else if (name === 'solar') {
    const sats3 = [{ a: 1.45, inc: 0.3, yw: 0, w: 0.9, M0: 0 }, { a: 1.92, inc: -0.5, yw: 1.2, w: 0.62, M0: 2 }, { a: 2.35, inc: 0.9, yw: 2.3, w: 0.45, M0: 4 }];
    ctx.fillStyle = C.line; ctx.globalAlpha = A((lod === 0 ? 0.5 : 0.35) * bright);
    for (const s3 of sats3) ring(ctx, x, y, R, s3.a, s3.inc, yaw + s3.yw, pass, 3, 72);
    if (lod === 0) return;
    const u0 = Math.min(1, Math.max(0, 0.58 + 0.42 * S.act - 0.6 * S.tidy));
    sats3.forEach((s3, si) => {
      const M = ph * s3.w + s3.M0;
      pr(Math.cos(M) * s3.a, 0, Math.sin(M) * s3.a, s3.inc, yaw + s3.yw);
      if ((P.d < 0) !== back) return;
      const sx = x + P.x * R, sy = y + P.y * R, s = R * 0.09;
      for (const sd of [-1, 1]) {
        let u = u0; if (si === 0 && sd < 0 && S.err > 0.01) u = lerp(u, 0.5 + 0.5 * Math.sin(mt * 7), S.err);
        const len = R * 0.62 * lerp(0.18, 1, u), drop = (1 - u) * R * 0.25;
        ctx.globalAlpha = A(back ? 0.55 : 1); ctx.fillStyle = L ? '#24366a' : '#2b4590';
        ctx.fillRect(sd < 0 ? sx - s * 0.6 - len : sx + s * 0.6, sy - R * 0.05 + drop * 0.5, len, R * 0.1);
        ctx.strokeStyle = errC(C.glow); ctx.globalAlpha = A(0.35 * bright); ctx.strokeRect(sd < 0 ? sx - s * 0.6 - len : sx + s * 0.6, sy - R * 0.05 + drop * 0.5, len, R * 0.1);
      }
      ctx.globalAlpha = A(back ? 0.6 : 1); ctx.fillStyle = '#c9a24a'; ctx.fillRect(sx - s * 0.5, sy - s, s, s * 2);
      em(sx, sy - s);
    });
  } else if (name === 'arcs') {
    const layers = [{ r: 1.15, n: 3, inc: 0.25, yw: 0, sp: 0.55, dir: 1, l: 0.15, w: 0.085 }, { r: 1.62, n: 4, inc: -0.5, yw: 0.8, sp: 0.36, dir: -1, l: 0.4, w: 0.05 }, { r: 2.12, n: 5, inc: 0.72, yw: 2.1, sp: 0.24, dir: 1, l: 0.6, w: 0.08 }];
    if (lod === 0) { ctx.globalAlpha = A(0.45 * bright); ctx.strokeStyle = C.line; ring(ctx, x, y, R, 1.62, 0.25, yaw, pass, 0); return; }
    const ex = (0.8 + 0.7 * S.act + 1.3 * S.err) * (1 - tE);
    let i = 0;
    layers.forEach((Lr, li) => {
      if (lod === 1 && li === 1) { i += Lr.n; return; }
      const span = (TAU / Lr.n) * 0.92;
      ctx.strokeStyle = mixColor(C.lite, C.part, 1 - Lr.l); ctx.lineWidth = Math.max(1, R * Lr.w * 1.6);
      for (let k = 0; k < Lr.n; k++, i++) {
        const dr = (hash01(v.id, 'ar' + i) - 0.5) * 0.4 * ex, dy = (hash01(v.id, 'ay' + i) - 0.5) * 0.75 * ex;
        const a0 = ph * Lr.sp * Lr.dir + (k * TAU) / Lr.n;
        ctx.beginPath(); let pen = false, last = null;
        for (let j = 0; j <= 12; j++) {
          const a = a0 + (span * j) / 12, rr = Lr.r + dr;
          pr(Math.cos(a) * rr, dy, Math.sin(a) * rr, Lr.inc * (1 - tE), yaw + Lr.yw);
          if ((P.d < 0) !== back) { pen = false; continue; }
          const sx = x + P.x * R, sy = y + P.y * R;
          if (!pen) { ctx.moveTo(sx, sy); pen = true; } else ctx.lineTo(sx, sy);
          last = [sx, sy];
        }
        ctx.globalAlpha = A((back ? 0.5 : 0.95) * (0.6 + 0.4 * bright)); ctx.stroke();
        if (last && k === 0) em(last[0], last[1]);
      }
    });
    ctx.lineWidth = lw;
  } else if (name === 'pocket') {
    const Rb = 2.05;
    if (pass === 1 || lod === 0) { // 유리 거품(테두리) — 앞에서 한 번
      if (pass === 1) {
        const r = Rb * R;
        ctx.globalAlpha = A((0.35 + 0.35 * S.bright) * (L ? 0.7 : 1));
        ctx.strokeStyle = errC(C.lite); ctx.lineWidth = Math.max(1, R * 0.04);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        ctx.globalAlpha = A(0.18 * bright); ctx.lineWidth = Math.max(2, R * 0.12); ctx.beginPath(); ctx.arc(x, y, r - R * 0.06, 0, TAU); ctx.stroke();
        ctx.lineWidth = lw;
      }
      if (lod === 0) return;
    }
    if (pass === 0 && lod >= 1) { // 별 코로나(본체 뒤)
      const fl = 1 + 0.45 * S.act * (0.6 + 0.4 * Math.sin(mt * 8));
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * 1.1 * fl);
      g.addColorStop(0, errC(C.glow)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = A((0.35 + 0.4 * S.bright) * (L ? 0.5 : 1)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 1.1 * fl, 0, TAU); ctx.fill();
    }
    const pl = [[0.68, 0.085, '#e0a458'], [1.08, 0.12, '#8ec5c8'], [1.52, 0.075, '#d9c9a3']];
    if (lod >= 2) { ctx.strokeStyle = C.line; ctx.globalAlpha = A(0.22 * bright); for (const p of pl) ring(ctx, x, y, R, p[0], 0.38, yaw, pass); }
    pl.forEach((p, i) => {
      let ang = hash01(v.id, 'pl' + i) * TAU + ph * 0.7 * Math.pow(1 / p[0], 1.5);
      ang = lerp(ang, Math.round(ang / TAU) * TAU + 0.6, tE);
      pr(Math.cos(ang) * p[0], 0, Math.sin(ang) * p[0], 0.38, yaw);
      if ((P.d < 0) !== back) return;
      const sx = x + P.x * R, sy = y + P.y * R;
      ctx.globalAlpha = A(1); ctx.fillStyle = p[2]; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, p[1] * R), 0, TAU); ctx.fill();
      em(sx, sy);
    });
  } else if (name === 'capsule') {
    const a = 1.6, e = 0.35, inc = 0.45;
    ctx.strokeStyle = C.line; ctx.globalAlpha = A((lod === 0 ? 0.5 : 0.32) * bright * (1 - tE * 0.6));
    // 이심 궤도(점선)
    ctx.beginPath(); let pen = false;
    for (let i = 0; i <= 48; i++) { const th = (i / 48) * TAU, r = (a * (1 - e * e)) / (1 + e * Math.cos(th)); pr(Math.cos(th) * r, 0, Math.sin(th) * r, inc, yaw + 0.3); if ((P.d < 0) !== back || i % 2) { pen = false; continue; } if (!pen) { ctx.moveTo(x + P.x * R, y + P.y * R); pen = true; } else ctx.lineTo(x + P.x * R, y + P.y * R); }
    ctx.stroke();
    if (lod === 0) return;
    if (pass === 0) { // 짐벌 받침대(세션 자리) 뒤쪽 + 받침 등
      ctx.strokeStyle = C.metal; ctx.lineWidth = Math.max(1, R * 0.04); ctx.globalAlpha = A(0.8);
      ctx.beginPath(); ctx.arc(x, y, R * 0.5, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, R * 0.5, R * 0.5 * SE, 0, 0, TAU); ctx.stroke(); ctx.lineWidth = lw;
      if (lod >= 2) { ctx.fillStyle = tE > 0.5 ? green : S.err > 0.3 && pulse > 0.5 ? red : C.dark; ctx.beginPath(); ctx.arc(x, y + R * 0.5 * CE, Math.max(1, R * 0.05), 0, TAU); ctx.fill(); }
    }
    const M = ph * 0.7, th = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin((M + e * Math.sin(M)) / 2), Math.sqrt(1 - e) * Math.cos((M + e * Math.sin(M)) / 2));
    let r = (a * (1 - e * e)) / (1 + e * Math.cos(th)); if (S.err > 0.01) r *= 1 + 0.3 * S.err * (0.5 + 0.5 * Math.sin(mt * 0.8));
    pr(Math.cos(th) * r, 0, Math.sin(th) * r, inc, yaw + 0.3);
    const px = lerp(P.x, 0, tE), py = lerp(P.y, -0.42 * CE, tE), pd = lerp(P.d, 0.1, tE);
    pr(Math.cos(th + 0.1) * r, 0, Math.sin(th + 0.1) * r, inc, yaw + 0.3);
    if ((pd < 0) === back) {
      const sx = x + px * R, sy = y + py * R, ang = lerp(Math.atan2(P.y - py, P.x - px), 0, tE);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
      ctx.globalAlpha = A(back ? 0.6 : 1); ctx.fillStyle = L ? '#cfc8b6' : '#e7e2d6';
      ctx.beginPath(); ctx.ellipse(0, 0, R * 0.36, R * 0.19, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = C.lite; ctx.fillRect(R * 0.05, -R * 0.06, R * 0.12, R * 0.05);
      if (S.act > 0.3 && !reduced) { ctx.globalAlpha = A(0.6 * S.act); ctx.fillStyle = C.glow; ctx.beginPath(); ctx.moveTo(-R * 0.36, 0); ctx.lineTo(-R * (0.6 + 0.15 * Math.sin(mt * 20)), -R * 0.06); ctx.lineTo(-R * (0.6 + 0.15 * Math.sin(mt * 20)), R * 0.06); ctx.fill(); }
      ctx.restore();
      em(sx, sy);
    }
  } else if (name === 'wormhole') {
    const K = 1.35, inc = -1.0 + 0.55, cx = x, cy = y - R * 0.45 * K * CE;
    if (lod === 0) { ctx.globalAlpha = A(0.5 * bright); ctx.strokeStyle = C.line; ring(ctx, cx, cy, R, K, inc, yaw, pass); return; }
    if (pass === 0) { // 소용돌이(고리 안, 본체 쪽으로 꺼짐)
      const n = lod === 1 ? 50 : lod === 2 ? 110 : 180;
      for (let i = 0; i < n; i++) {
        const p0 = hash01(v.id + '', 'w' + (i % 61)) + i * 0.618, sp = 0.7 + 0.6 * hash01('w', 's' + i);
        const tt = ((p0 + ph * 0.05 * sp * (1 - S.tidy * 0.9)) % 1 + 1) % 1, rr = 0.93 - 0.81 * tt;
        let ang = i * 2.399 + ph * 0.55 * (1.1 / (rr + 0.15));
        ang = lerp(ang, Math.round((ang - rr * 2.2) / 2.0944) * 2.0944 + rr * 2.2, S.tidy * 0.85);
        pr(Math.cos(ang) * rr * K, -(0.95 - rr) * 0.62 * K * (1 - S.tidy * 0.85), Math.sin(ang) * rr * K, inc, yaw);
        ctx.globalAlpha = A((0.2 + 0.6 * S.bright) * (0.4 + 0.6 * tt));
        ctx.fillStyle = S.err > 0.3 ? mixColor(C.glow, red, 0.6) : rr < 0.45 ? (L ? '#5b4bb0' : '#c4b5fd') : C.glow;
        ctx.fillRect(cx + P.x * R - 0.7, cy + P.y * R - 0.7, 1.4, 1.4);
      }
    }
    ctx.strokeStyle = errC(L ? mixColor(col, '#000000', 0.2) : mixColor(col, '#ffffff', 0.1)); ctx.lineWidth = Math.max(1.2, R * 0.08); ctx.globalAlpha = A(back ? 0.7 : 1);
    ring(ctx, cx, cy, R, K, inc, yaw, pass, 0, 56); ctx.lineWidth = lw;
    for (let k = 0; k < 3; k++) { pr(Math.cos((k * TAU) / 3) * K, 0, Math.sin((k * TAU) / 3) * K, inc, yaw); if ((P.d < 0) !== back) continue; em(cx + P.x * R, cy + P.y * R); }
    if (pass === 1 && lod >= 2) { // 점선 끝 작은 출구 고리
      pr(1.7, 0.95, -1.05, 0, yaw); const ex = x + P.x * R, ey = y + P.y * R;
      ctx.globalAlpha = A(0.35 * bright); ctx.strokeStyle = C.line; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = A(0.9); ctx.strokeStyle = C.lite; ctx.beginPath(); ctx.ellipse(ex, ey, R * 0.2, R * 0.2 * (0.4 + 0.3 * Math.sin(mt * 0.5)), 0, 0, TAU); ctx.stroke();
    }
  } else if (name === 'cassette') {
    const K = 1.2, Rt = 1.45 * K, NS = CASSETTE_N;
    ctx.strokeStyle = C.line; ctx.globalAlpha = A((lod === 0 ? 0.5 : 0.3) * bright); ring(ctx, x, y, R, Rt, 0, 0, pass, 1, 64);
    if (lod === 0) return;
    const cm = cassetteModel(v.hist, v.icons ? v.icons.size : 0, v.node.counts && v.node.counts.tools);
    if (pass === 0) {
      const key = cm.cur * 10 + cm.cards[cm.cur];
      if (key !== st.curKey) { st.curKey = key; st.curAt = now; }
      const target = (cm.cur / NS) * TAU - Math.PI / 2;
      let dd = target - st.rot; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); st.rot += dd * Math.min(1, st.dt * 2.2);
    }
    const prog = cm.cards[cm.cur] === 3 ? 1 - Math.exp(-(now - st.curAt) / 8) : 0;
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * TAU - st.rot * (1 - tE), code = cm.cards[k];
      pr(Math.cos(a) * Rt * (1 - tE), 0, Math.sin(a) * Rt * (1 - tE), 0, 0);
      if ((P.d < 0) !== back) continue;
      const sx = x + P.x * R, sy = y + P.y * R + tE * (R * 0.6 - k * 1.2);
      const w = R * 0.36 * Math.max(0.25, Math.abs(Math.sin(a))) * (1 - tE) + R * 0.4 * tE, h = R * 0.5 * (1 - tE * 0.9);
      const fill = code === 1 ? (L ? '#bfe3cf' : '#1d3a33') : code === 2 ? (L ? '#f3c4c4' : '#3a1d1d') : code === 3 ? (L ? '#f2deb0' : '#3a2f12') : null;
      ctx.globalAlpha = A(code ? (back ? 0.6 : 1) : 0.35);
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(sx - w / 2, sy - h / 2, w, h); }
      ctx.strokeStyle = code === 1 ? green : code === 2 ? red : code === 3 ? errC(C.glow) : C.line; ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
      if (code && lod >= 2 && h > 3) { const p = code === 3 ? prog : 1; ctx.fillStyle = code === 2 ? red : code === 1 ? green : C.glow; ctx.fillRect(sx - w * 0.4, sy + h * 0.28, w * 0.8 * p, Math.max(1, h * 0.08)); }
      if (k === cm.cur) em(sx, sy);
    }
  }
  ctx.globalAlpha = 1;
}

/** 작은 본체(pass 사이). 서브 = 원·다면체 실루엣, claude -p = 작은 상자(주머니 항성계는 별) */
export function drawVariantCore(view, ctx, v, name, x, y, R, alpha, now, col, edge) {
  const L = !!view.tokens.isLight;
  const k = VARIANT_CORE[name] || 0.4;
  const r = Math.max(1.2, R * k);
  ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = Math.max(0.8, r * 0.12);
  if (name === 'pocket') {
    ctx.fillStyle = L ? mixColor(col, '#000000', 0.1) : mixColor(col, '#ffffff', 0.55);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  } else if (name === 'capsule' || name === 'wormhole' || name === 'cassette') {
    const h = r * 0.725;
    const rot = view.reduced ? 0 : now * 0.3 + (v.seed || 0);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot * 0.6);
    ctx.fillRect(-h, -h, 2 * h, 2 * h); ctx.strokeRect(-h, -h, 2 * h, 2 * h); ctx.restore();
  } else if (name === 'belt' || name === 'crystal') {
    const n = name === 'belt' ? 6 : 4, rot = view.reduced ? 0 : now * 0.2;
    ctx.beginPath(); for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * (name === 'crystal' ? 1.25 : 1)) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r * (name === 'crystal' ? 1.25 : 1)); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
