// Planet 2D 행성 연출 — 3D(planet-deco.js)와 같은 인상을 Canvas 2D 로 단순하게.
//  · 메인 = 기계 행성: 몸체 원 + 자전하는 경선·위선 이음선, 이음선 사이 코어 광 맥동, 해치 둘(도구 호출 때 열려 빛),
//    적도 기어 띠(톱니가 몸체와 반대로 흐름), 기운 점선 궤도 링(뒤 반쪽은 몸체 뒤, 점선이 돌며 운반체 하나), 안테나(도구 때 솟고 깜빡).
//  · 서브에이전트 = 원 + 흐르는 구름 띠 + 대기 테두리 + 작은 위성, 활동 때 테두리 발광 맥동. 워크플로 에이전트·claude -p 는 위성만.
//  · 상태 세기는 planet-core.mjs MECH·SUB 그대로, LOD 는 화면 반지름(6px 미만 몸체만, 14px 미만 잔부품 없음).
import { MECH, SUB, planetMode, approach, hatchOpen } from '../planet-core.mjs';
import { mixColor } from './flat-core.mjs';

const TAU = Math.PI * 2;

function stepState(v, table, now, reduced, dim) {
  const pd = v._pd || (v._pd = { cur: {}, spinA: (v.seed || 0) * 3, moonA: (v.seed || 0) * 5, last: now });
  const dt = Math.min(0.2, Math.max(0, now - pd.last)); pd.last = now;
  const mode = planetMode(v.node.status, v.icons ? v.icons.size : 0, dim);
  const c = approach(pd.cur, table[mode], dt, 2.5);
  const k = reduced ? 0.15 : 1;
  pd.spinA += dt * c.spin * k;
  pd.moonA += dt * (0.35 + 0.9 * c.spin) * k;
  return pd;
}
const colorsOf = (v, col, L) => {
  if (v._pdK === col + L) return v._pdC;
  v._pdK = col + L;
  return (v._pdC = {
    dark: mixColor(col, '#000000', L ? 0.42 : 0.5),
    light: mixColor(col, '#ffffff', 0.55),
    metal: mixColor(col, L ? '#8a93a3' : '#9aa4b6', 0.55),
    seam: mixColor(col, '#fff3dc', 0.45),
  });
};

/** 메인 기계 행성. 반환 없음(globalAlpha 는 alpha 로 되돌려 둔다) */
export function drawMechPlanet(view, ctx, v, x, y, R, alpha, now, col, edge, pulse) {
  const L = !!view.tokens.isLight, reduced = !!view.reduced;
  const pd = stepState(v, MECH, now, reduced, !!v.scopeRecent);
  const c = pd.cur, C = colorsOf(v, col, L);
  const detail = R >= 6, fine = R >= 14;
  const rot = reduced ? 0 : now * (v.node.status === 'active' ? 0.35 : 0.08) + (v.seed || 0);
  const tilt = -0.36, rx = R * 1.62, ry = R * 0.42;
  // 후광(3D glow 구 1.5배)
  ctx.globalAlpha = alpha * (L ? 0.1 : 0.16) * (1 + 0.06 * pulse);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, R * 1.5, 0, TAU); ctx.fill();
  // 궤도 링 뒤 반쪽(몸체 뒤)
  const ringLw = Math.max(1, R * 0.07);
  const dashA = [Math.max(2, R * 0.16), Math.max(1.5, R * 0.1)];
  if (detail) {
    ctx.globalAlpha = alpha * 0.75; ctx.strokeStyle = C.metal; ctx.lineWidth = ringLw;
    ctx.setLineDash(dashA); ctx.lineDashOffset = -pd.spinA * R * 1.6;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, tilt, Math.PI, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  // 몸체
  ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1, R * 0.07);
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill(); ctx.stroke();
  if (detail) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, R * 0.97, 0, TAU); ctx.clip();
    const core = c.glow * (0.62 + 0.38 * Math.sin(now * TAU * (reduced ? 0.2 : c.pulse)));
    // 이음선: 위선 4줄 + 자전하는 경선 6줄(앞 반쪽), 어두운 선 위에 코어 광
    ctx.lineWidth = Math.max(0.8, R * 0.03);
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? C.seam : C.dark;
      ctx.globalAlpha = alpha * (pass ? Math.min(0.9, core * (L ? 0.5 : 0.85)) : 0.55);
      if (pass && ctx.globalAlpha < 0.03) break;
      ctx.beginPath();
      for (let j = 1; j <= 4; j++) { const yy = y + R * (j / 2.5 - 1); const hw = Math.sqrt(Math.max(0, R * R - (yy - y) * (yy - y))); ctx.moveTo(x - hw, yy); ctx.lineTo(x + hw, yy); }
      for (let k = 0; k < 6; k++) {
        const m = rot + (k * Math.PI) / 6, s = Math.sin(m);
        if (Math.cos(m) < 0) continue;
        ctx.moveTo(x, y - R); ctx.ellipse(x, y, Math.abs(s) * R, R, 0, -Math.PI / 2, Math.PI / 2, s < 0);
      }
      ctx.stroke();
    }
    // 해치 둘: 몸체와 함께 돌고, 도구 호출 때 열려 안쪽 빛
    if (fine) for (let i = 0; i < 2; i++) {
      const m = rot + 0.9 + i * 2.6, cz = Math.cos(m);
      if (cz < 0.15) continue;
      const hx = x + Math.sin(m) * R * 0.62, hy = y + (i ? 0.28 : -0.34) * R, hw = R * 0.2 * cz, hh = R * 0.17;
      ctx.globalAlpha = alpha * 0.8; ctx.strokeStyle = C.dark; ctx.lineWidth = Math.max(0.8, R * 0.025);
      ctx.strokeRect(hx - hw / 2, hy - hh / 2, hw, hh);
      const o = hatchOpen(i, now, c.hatch);
      if (o > 0.02) { ctx.globalAlpha = alpha * Math.min(1, 0.4 + o); ctx.fillStyle = C.light; ctx.fillRect(hx - (hw * o) / 2, hy - (hh * o) / 2, hw * o, hh * o); }
    }
    // 표면 조명 점: 위선 둘을 따라 오간다
    if (c.lights > 0.05) {
      ctx.fillStyle = '#fff6e6';
      for (let j = 0; j < 2; j++) {
        const yy = y + R * (j ? 0.2 : -0.4), hw = Math.sqrt(Math.max(0, R * R - (yy - y) * (yy - y)));
        const u = ((now * 0.12 * (0.4 + c.lights) * (j ? -1 : 1) + j * 0.37 + (v.seed || 0)) % 1 + 1) % 1;
        ctx.globalAlpha = alpha * Math.min(1, c.lights);
        ctx.beginPath(); ctx.arc(x - hw + 2 * hw * u, yy, Math.max(1, R * 0.05), 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    // 적도 기어 띠: 앞 반쪽 띠 + 몸체와 반대로 흐르는 톱니
    ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = C.metal; ctx.lineWidth = Math.max(1.2, R * 0.09);
    ctx.beginPath(); ctx.ellipse(x, y + R * 0.05, R * 1.04, R * 0.16, 0, 0, Math.PI); ctx.stroke();
    if (fine) {
      ctx.fillStyle = C.metal; const tw = Math.max(1.2, R * 0.07);
      for (let i = 0; i < 24; i++) {
        const a = -pd.spinA * 0.55 + (i * TAU) / 24, sa = Math.sin(a);
        if (sa < 0.05) continue;
        ctx.fillRect(x + Math.cos(a) * R * 1.07 - tw / 2, y + R * 0.05 + sa * R * 0.16 - tw * 0.6, tw, tw * 1.2);
      }
    }
    // 안테나: 몸체와 함께 돌며 도구 호출 때 솟고 끝이 깜빡인다
    if (fine) {
      const m = rot + 0.6;
      if (Math.cos(m) > -0.3) {
        const bx = x + Math.sin(m) * R * 0.5, by = y - R * 0.86, len = R * (0.18 + 0.38 * c.ant);
        ctx.globalAlpha = alpha; ctx.strokeStyle = C.metal; ctx.lineWidth = Math.max(1, R * 0.04);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.sin(m) * len * 0.3, by - len); ctx.stroke();
        const blink = c.ant > 0.5 ? 0.55 + 0.45 * Math.sin(now * (2 + 6 * c.ant)) : 0.6;
        ctx.globalAlpha = alpha * blink; ctx.fillStyle = C.light;
        ctx.beginPath(); ctx.arc(bx + Math.sin(m) * len * 0.3, by - len, Math.max(1.2, R * 0.07), 0, TAU); ctx.fill();
      }
    }
    // 궤도 링 앞 반쪽 + 운반체
    ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = C.metal; ctx.lineWidth = ringLw;
    ctx.setLineDash(dashA); ctx.lineDashOffset = -pd.spinA * R * 1.6;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, tilt, 0, Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    if (c.glow > 0.08) {
      const a = pd.spinA % TAU, ct = Math.cos(tilt), st = Math.sin(tilt);
      const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      ctx.globalAlpha = alpha * Math.min(1, 0.3 + c.glow) * (Math.sin(a) < 0 ? 0.35 : 1); ctx.fillStyle = C.light;
      ctx.beginPath(); ctx.arc(x + ex * ct - ey * st, y + ex * st + ey * ct, Math.max(1.4, R * 0.08), 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = alpha;
}

/** 서브에이전트 행성(구): surface=false 면 몸체는 그리지 않고 위성만(워크플로 에이전트·claude -p) */
export function drawSubPlanet(view, ctx, v, x, y, R, alpha, now, col, edge, surface) {
  const L = !!view.tokens.isLight, reduced = !!view.reduced;
  const pd = stepState(v, SUB, now, reduced, !!v.scopeRecent);
  const c = pd.cur, C = colorsOf(v, col, L);
  const detail = R >= 6;
  const ma = pd.moonA % TAU, mx = Math.cos(ma) * R * 1.85, my = Math.sin(ma) * R * 0.5 - Math.cos(ma) * R * 0.25;
  const behind = Math.sin(ma) < 0;
  const moon = () => {
    if (!detail) return;
    ctx.globalAlpha = alpha * (behind ? 0.55 : 1); ctx.fillStyle = mixColor(col, L ? '#9aa1ad' : '#b8bfcc', 0.65);
    ctx.beginPath(); ctx.arc(x + mx, y + my, Math.max(1.2, R * 0.17), 0, TAU); ctx.fill();
  };
  if (behind) moon();
  if (surface) {
    // 대기 테두리(활동 때 맥동)
    if (detail) {
      const pul = 0.6 + 0.6 * c.glow * (0.5 + 0.5 * Math.sin(now * 3.2 + (v.seed || 0)));
      ctx.globalAlpha = alpha * (L ? 0.3 : 0.4) * pul; ctx.strokeStyle = C.light; ctx.lineWidth = Math.max(1, R * 0.12);
      ctx.beginPath(); ctx.arc(x, y, R * 1.08, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill(); ctx.stroke();
    if (detail) {
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, R * 0.97, 0, TAU); ctx.clip();
      // 띠(어두운 줄 둘) + 흐르는 구름(밝은 타원, 위도마다 속도 다름)
      ctx.globalAlpha = alpha * 0.22; ctx.fillStyle = C.dark;
      for (let j = 0; j < 2; j++) { const yy = y + R * (j ? 0.32 : -0.22) + Math.sin(now * 0.5 + j) * R * 0.03; ctx.fillRect(x - R, yy, 2 * R, R * 0.13); }
      ctx.fillStyle = '#ffffff';
      for (let j = 0; j < 3; j++) {
        const yy = y + R * (j - 1) * 0.45, sp = (0.12 + 0.3 * c.spin) * (1 + 0.5 * Math.sin(j * 1.7));
        for (let k = 0; k < 2; k++) {
          const u = ((now * sp + k * 0.5 + j * 0.31 + (v.seed || 0) * 0.1) % 1 + 1) % 1;
          ctx.globalAlpha = alpha * (L ? 0.32 : 0.24);
          ctx.beginPath(); ctx.ellipse(x - R * 1.3 + u * R * 2.6, yy, R * 0.34, R * 0.07, 0, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
      ctx.globalAlpha = alpha * (L ? 0.35 : 0.28); ctx.fillStyle = '#ffffff'; // 왼쪽 위 하이라이트
      ctx.beginPath(); ctx.arc(x - R * 0.32, y - R * 0.34, R * 0.3, 0, TAU); ctx.fill();
    }
  }
  if (!behind) moon();
  ctx.globalAlpha = alpha;
}
