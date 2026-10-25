// Planet 2D 행성 연출 — 3D(planet-deco.js)와 같은 인상을 Canvas 2D 로 단순하게.
//  · 메인 = 기계 행성: 몸체 원 + 자전하는 경선·위선 이음선, 이음선 사이 코어 광 맥동, 해치 둘(도구 호출 때 열려 빛),
//    적도 기어 띠(톱니가 몸체와 반대로 흐름), 기운 점선 궤도 링(뒤 반쪽은 몸체 뒤, 점선이 돌며 운반체 하나), 안테나(도구 때 솟고 깜빡).
//  · 서브에이전트 = 유형 8종(subType(id)): 가스 거인(굵은 띠·폭풍 점)·용암(발광 균열·분출)·얼음(극관·반짝임)·고리(넓은 납작 고리·그림자)·
//    쌍성(짝 몸체)·위성 군단(바위 + 작은 위성 여럿 — 궤도는 planet-orbits2d.js)·혜성(코마 + 부모 반대쪽 꼬리)·결정(다면체·면 반짝임).
//    궤도·위성은 모두 planet-orbits2d.js(orbitSpec). 상태: 생각 = 흐름 빨라짐, 도구 = 유형별 반응, 대기 = 느려지고 어두움.
//  · 상태 세기는 planet-core.mjs MECH·SUB 그대로, LOD 는 화면 반지름(6px 미만 몸체만, 14px 미만 잔부품 없음).
import { MECH, SUB, planetMode, approach, hatchOpen, subType, hash01, orbitPoint } from '../planet-core.mjs';
import { projOrbit, burst } from './planet-orbits2d.js';
import { mixColor } from './flat-core.mjs';
import { Escapement, TOURB_GEO as TG } from '../tourbillon-core.mjs'; // 뚜르비용(위에서 본 동심 링·톱니·진동 휠)

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
  // 후광(3D glow 구 1.5배)
  ctx.globalAlpha = alpha * (L ? 0.1 : 0.16) * (1 + 0.06 * pulse);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, R * 1.5, 0, TAU); ctx.fill();
  // 예전 기운 점선 링·운반체·안테나는 뚜르비용(drawTourb2D)이 대신한다
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
  }
  ctx.globalAlpha = alpha;
}

/**
 * 서브에이전트 행성(유형 8종, subType(id) 로 고정). pass 0 = 몸체 뒤에 깔리는 것(고리 뒤 반쪽·혜성 꼬리·짝 몸체 뒤),
 * pass 1 = 몸체 + 앞(고리 앞 반쪽·짝 몸체 앞·반짝임). 색은 노드 색(종류·세션)에서 변형만.
 */
export function drawSubPlanet(view, ctx, v, x, y, R, alpha, now, col, edge, pass) {
  const L = !!view.tokens.isLight, reduced = !!view.reduced;
  const pd = stepState(v, SUB, now, reduced, !!v.scopeRecent);
  const c = pd.cur, C = colorsOf(v, col, L);
  const type = pd.type || (pd.type = subType(v.id));
  const mode = planetMode(v.node.status, v.icons ? v.icons.size : 0, !!v.scopeRecent);
  const tool = mode === 'tool' ? 1 : 0;
  const dt = Math.min(0.2, Math.max(0, now - (pd.last2 ?? now))); if (pass === 1) pd.last2 = now;
  if (pass === 1) {
    pd.toolK = (pd.toolK || 0) + (tool - (pd.toolK || 0)) * Math.min(1, dt * 3);
    const dimT = mode === 'wait' ? 1 : mode === 'off' ? 0.6 : 0;
    pd.dimK = (pd.dimK ?? dimT) + (dimT - (pd.dimK ?? dimT)) * Math.min(1, dt * 2);
  }
  const tk = pd.toolK || 0;
  const T = C.T || (C.T = typeColors(col, L));
  const detail = R >= 6;
  const tm = reduced ? 0 : now;
  const flow = pd.spinA; // 표면 흐름(상태 세기 반영 누적)
  const seed = (v.seed || 0);

  if (pass === 0) {
    if (!detail) return;
    if (type === 'ringed') drawRing(ctx, x, y, R, alpha, T, L, pd, tk, 0);
    else if (type === 'comet') drawTail(view, ctx, v, x, y, R, alpha, tm, T, L, tk);
    else if (type === 'binary') drawTwin(view, ctx, v, x, y, R, alpha, T, 0, tk, tm);
    return;
  }
  const bodyCol = T[type] || col;
  // 대기·코마·불씨 테두리
  if (detail && type === 'comet') { // 코마: 부드러운 빛무리
    const gr = ctx.createRadialGradient(x, y, R * 0.8, x, y, R * 1.9);
    gr.addColorStop(0, T.tail); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * (L ? 0.35 : 0.45) * (0.8 + 0.4 * c.glow); ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, R * 1.9, 0, TAU); ctx.fill();
  } else if (detail && type !== 'crystal' && type !== 'swarm') {
    const pul = 0.6 + 0.6 * c.glow * (0.5 + 0.5 * Math.sin(tm * 3.2 + seed));
    const rimCol = type === 'lava' ? T.lavaGlow : C.light;
    ctx.globalAlpha = alpha * (L ? 0.26 : 0.36) * pul;
    ctx.strokeStyle = rimCol; ctx.lineWidth = Math.max(1, Math.min(6, R * 0.12));
    ctx.beginPath(); ctx.arc(x, y, R * 1.08, 0, TAU); ctx.stroke();
  }
  // 몸체 실루엣
  ctx.globalAlpha = alpha; ctx.fillStyle = bodyCol; ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1, R * 0.06);
  const crystal = type === 'crystal';
  const facets = 7, frot = (flow * 0.35 + seed) % TAU;
  const bodyPath = () => {
    ctx.beginPath();
    if (crystal && detail) {
      for (let i = 0; i < facets; i++) { const a = frot + (i * TAU) / facets, rr = R * (i % 2 ? 0.9 : 1.05); i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath();
    } else ctx.arc(x, y, R, 0, TAU);
  };
  bodyPath(); ctx.fill(); ctx.stroke();
  if (!detail) { ctx.globalAlpha = alpha; return; }
  ctx.save(); bodyPath(); ctx.clip();
  if (type === 'gas' || type === 'ringed') {
    // 굵은 띠(물결) — 고리 행성은 옅게
    const k = type === 'gas' ? 1 : 0.55;
    for (let j = 0; j < 5; j++) {
      const yy = y + R * (-0.78 + j * 0.36), w = Math.sin(flow * 0.8 + j * 1.3) * R * 0.04;
      ctx.globalAlpha = alpha * (j % 2 ? 0.16 : 0.24) * k; ctx.fillStyle = j % 2 ? '#ffffff' : C.dark;
      ctx.fillRect(x - R, yy + w, 2 * R, R * (j % 2 ? 0.14 : 0.2));
    }
    if (type === 'gas') {
      // 소용돌이 폭풍 점: 띠를 따라 흐름, 도구 호출 때 번쩍
      const u = ((flow * 0.18 + seed * 0.1) % 1 + 1) % 1, sx = x - R * 1.2 + u * R * 2.4, sy = y + R * 0.26;
      ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = T.storm;
      ctx.beginPath(); ctx.ellipse(sx, sy, R * 0.3, R * 0.15, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = alpha * 0.5; ctx.strokeStyle = C.dark; ctx.lineWidth = Math.max(0.8, R * 0.03);
      ctx.beginPath(); ctx.ellipse(sx, sy, R * 0.2, R * 0.09, 0, 0, TAU); ctx.stroke();
      const fl = tk * Math.max(0, Math.sin(tm * 13 + seed * 7) * Math.sin(tm * 5.3)) ;
      if (fl > 0.25) { ctx.globalAlpha = alpha * Math.min(1, fl); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sx + R * 0.05, sy, R * 0.12, 0, TAU); ctx.fill(); }
    }
  } else if (type === 'lava') {
    // 어두운 지각 사이 발광 균열(맥동, 도구 때 밝게)
    const cr = pd.cracks || (pd.cracks = cracksOf(v.id));
    const pul = 0.45 + 0.35 * Math.sin(tm * (2 + 3 * tk) + seed) + 0.4 * tk;
    const ca = Math.cos(flow * 0.25), sa = Math.sin(flow * 0.25);
    ctx.strokeStyle = T.lavaGlow; ctx.lineCap = 'round';
    for (let pass2 = 0; pass2 < 2; pass2++) {
      ctx.globalAlpha = alpha * Math.min(1, pul * (pass2 ? 1 : 0.3)); ctx.lineWidth = Math.max(0.8, R * (pass2 ? 0.045 : 0.13));
      ctx.beginPath();
      for (const line of cr) for (let i = 0; i < line.length; i += 2) {
        const px = x + (line[i] * ca - line[i + 1] * sa) * R, py = y + (line[i] * sa + line[i + 1] * ca) * R;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  } else if (type === 'ice') {
    ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = L ? '#f4f8fc' : '#eef6ff';
    ctx.beginPath(); ctx.ellipse(x, y - R * 0.86, R * 0.62, R * 0.3, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = alpha * 0.55; ctx.beginPath(); ctx.ellipse(x, y + R * 0.92, R * 0.45, R * 0.18, 0, 0, TAU); ctx.fill();
  } else if (type === 'swarm' || type === 'binary') {
    // 바위 표면: 운석 구덩이
    const cs = pd.craters || (pd.craters = cratersOf(v.id));
    const ox = ((flow * 0.12) % 2) * R;
    ctx.fillStyle = C.dark;
    for (let i = 0; i < cs.length; i += 3) {
      let cx = cs[i] * R + ox; if (cx > R * 1.1) cx -= R * 2.2;
      ctx.globalAlpha = alpha * 0.3; ctx.beginPath(); ctx.arc(x + cx, y + cs[i + 1] * R, cs[i + 2] * R, 0, TAU); ctx.fill();
    }
  } else if (type === 'comet') {
    ctx.globalAlpha = alpha * 0.3; ctx.fillStyle = C.dark;
    ctx.beginPath(); ctx.arc(x + R * 0.25, y + R * 0.15, R * 0.35, 0, TAU); ctx.fill();
  } else if (crystal) {
    // 면 명암 + 반짝이는 면(도구 때 물결 번쩍)
    for (let i = 0; i < facets; i++) {
      const a0 = frot + (i * TAU) / facets, a1 = frot + ((i + 1) * TAU) / facets;
      const r0 = R * (i % 2 ? 0.9 : 1.05), r1 = R * ((i + 1) % 2 ? 0.9 : 1.05);
      const lit = 0.5 + 0.5 * Math.cos((a0 + a1) / 2 + 2.3);
      const wave = tk * Math.max(0, Math.sin(tm * 6 - i * 0.9));
      const gl = Math.max(0, Math.sin(tm * 1.3 + i * 2.1 + seed)) ** 8;
      ctx.globalAlpha = alpha * (0.08 + 0.3 * lit + 0.5 * Math.max(gl, wave));
      ctx.fillStyle = lit > 0.5 || gl > 0.2 || wave > 0.2 ? '#ffffff' : C.dark;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0); ctx.lineTo(x + Math.cos(a1) * r1, y + Math.sin(a1) * r1); ctx.closePath(); ctx.fill();
    }
  }
  // 그늘(오른쪽 아래) + 대기·정지 어두움
  if (!crystal) { // 둥근 명암: 왼쪽 위 빛 → 오른쪽 아래 그늘(방사 그라디언트)
    ctx.globalAlpha = alpha; ctx.fillStyle = shadeGrad(ctx, R, L);
    ctx.translate(x, y); ctx.fillRect(-R, -R, 2 * R, 2 * R); ctx.translate(-x, -y);
  }
  if (pd.dimK > 0.02) { ctx.globalAlpha = alpha * 0.22 * pd.dimK; ctx.fillStyle = view.tokens.bg; ctx.fillRect(x - R * 1.1, y - R * 1.1, R * 2.2, R * 2.2); }
  ctx.restore();
  // 하이라이트(왼쪽 위)
  if (!crystal) {
    ctx.globalAlpha = alpha * (L ? 0.32 : (type === 'ice' ? 0.42 : 0.22)); ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - R * 0.34, y - R * 0.36, R * (type === 'ice' ? 0.24 : 0.3), 0, TAU); ctx.fill();
  }
  // 앞쪽 부품
  if (type === 'ringed') drawRing(ctx, x, y, R, alpha, T, L, pd, tk, 1);
  else if (type === 'binary') drawTwin(view, ctx, v, x, y, R, alpha, T, 1, tk, tm);
  else if (type === 'ice') {
    // 결정 반짝임(도구 때 더 많고 밝게)
    const n = 3 + Math.round(3 * tk);
    ctx.strokeStyle = L ? mixColor(col, '#ffffff', 0.85) : '#ffffff'; ctx.lineWidth = Math.min(1.2, Math.max(0.7, R * 0.02));
    for (let i = 0; i < n; i++) {
      const a = hash01(v.id, 'g' + i) * TAU, rr = R * (0.3 + 0.6 * hash01(v.id, 'gr' + i));
      const b = Math.max(0, Math.sin(tm * (2.2 + i * 0.7) + i * 1.9)) ** 6 * (0.6 + 0.6 * tk);
      if (b < 0.05) continue;
      const gx = x + Math.cos(a) * rr, gy = y + Math.sin(a) * rr, gs = Math.min(7, R * (0.12 + 0.1 * b));
      ctx.globalAlpha = alpha * Math.min(1, b);
      ctx.beginPath(); ctx.moveTo(gx - gs, gy); ctx.lineTo(gx + gs, gy); ctx.moveTo(gx, gy - gs); ctx.lineTo(gx, gy + gs); ctx.stroke();
    }
  } else if (type === 'lava' && tk > 0.3 && !reduced && Math.random() < tk * 0.5) {
    // 용암 분출: 위쪽 가장자리에서 솟았다 떨어지는 불씨
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    burst(view, x + Math.cos(a) * R, y + Math.sin(a) * R, Math.cos(a) * R * 1.2, Math.sin(a) * R * 3.2, 0.9, T.lavaGlow, Math.max(1, R * 0.06), R * 6);
  }
  ctx.globalAlpha = alpha;
}

/** 몸체 명암 그라디언트(원점 기준, 반지름 px 를 2px 단위로 묶어 캐시) — 매 프레임 노드마다 만들던 비용을 없앰 */
const _shade = new Map();
function shadeGrad(ctx, R, L) {
  const k = (L ? 'L' : 'D') + Math.round(R / 2);
  let g = _shade.get(k);
  if (!g) {
    const r = Math.round(R / 2) * 2 || 2;
    g = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.1, -r * 0.1, -r * 0.1, r * 1.25);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, L ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.5)');
    if (_shade.size > 400) _shade.clear();
    _shade.set(k, g);
  }
  return g;
}

function typeColors(col, L) {
  return {
    gas: col,
    ringed: mixColor(col, '#e8dcc0', 0.18),
    lava: mixColor(col, '#140c0a', L ? 0.45 : 0.6),
    lavaGlow: L ? mixColor(col, '#ff6a00', 0.78) : mixColor(col, '#ffc27a', 0.6),
    ice: mixColor(col, '#ffffff', L ? 0.35 : 0.5),
    binary: mixColor(col, '#7d8794', 0.25),
    twin: mixColor(col, '#ffffff', L ? 0.1 : 0.25),
    swarm: mixColor(col, '#7d8794', 0.35),
    comet: mixColor(col, '#6f7680', 0.45),
    tail: L ? mixColor(col, '#9fb3c8', 0.3) : mixColor(col, '#e6f2ff', 0.55),
    crystal: mixColor(col, L ? '#ffffff' : '#0b1220', 0.15),
    storm: mixColor(col, '#fff2dc', 0.45),
    ring: L ? mixColor(col, '#475569', 0.35) : mixColor(col, '#efe4cc', 0.5),
  };
}

/** 넓은 납작 고리(뒤 반쪽 pass 0 / 앞 반쪽 pass 1): 띠 셋 + 카시니 틈, 앞 반쪽엔 몸체 그림자, 도구 때 무늬가 빨리 돌고 밝아짐 */
function drawRing(ctx, x, y, R, alpha, T, L, pd, tk, pass) {
  const tilt = -0.32, fl = 0.3;
  const a0 = pass ? 0 : Math.PI, a1 = pass ? Math.PI : TAU;
  const bands = [[1.45, 0.12, 0.5], [1.7, 0.16, 0.65], [2.0, 0.1, 0.4]];
  ctx.strokeStyle = T.ring;
  for (const [r, w, a] of bands) {
    ctx.globalAlpha = alpha * a * (0.7 + 0.4 * tk) * (pass ? 1 : 0.8); ctx.lineWidth = Math.max(1, R * w);
    ctx.beginPath(); ctx.ellipse(x, y, R * r, R * r * fl, tilt, a0, a1); ctx.stroke();
  }
  // 무늬 흐름(점선 띠) — 고리 회전
  ctx.globalAlpha = alpha * (0.25 + 0.45 * tk); ctx.lineWidth = Math.max(0.8, R * 0.05);
  ctx.setLineDash([Math.max(2, R * 0.3), Math.max(2, R * 0.22)]); ctx.lineDashOffset = -pd.spinA * R * (1.5 + 4 * tk);
  ctx.beginPath(); ctx.ellipse(x, y, R * 1.7, R * 1.7 * fl, tilt, a0, a1); ctx.stroke();
  ctx.setLineDash([]);
  if (pass) { // 몸체 그림자(빛은 왼쪽 위 → 고리 오른쪽 앞)
    ctx.globalAlpha = alpha * (L ? 0.2 : 0.4); ctx.strokeStyle = '#000000'; ctx.lineWidth = Math.max(1, R * 0.5);
    ctx.beginPath(); ctx.ellipse(x, y, R * 1.62, R * 1.62 * fl, tilt, 0.25, 0.85); ctx.stroke();
  }
}

/** 혜성 꼬리: 부모 반대 방향(항성풍), 도구 때 길어지고 일렁임 */
function drawTail(view, ctx, v, x, y, R, alpha, tm, T, L, tk) {
  const pv = v.node.parentId && view.vis.get(v.node.parentId);
  let dx = 0.8, dy = -0.45;
  if (pv && pv._sp) { dx = x - pv._sp.x; dy = y - pv._sp.y; }
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const len = R * (2.6 + 1.6 * tk) * (1 + 0.06 * Math.sin(tm * 7 + (v.seed || 0)) * (0.3 + tk));
  const nx = -dy, ny = dx;
  for (let i = 0; i < 2; i++) {
    const k = i ? 0.55 : 1, w = R * (i ? 0.45 : 0.85);
    const gr = ctx.createLinearGradient(x, y, x + dx * len * k, y + dy * len * k);
    gr.addColorStop(0, T.tail); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * (L ? 0.3 : 0.42) * (i ? 1.3 : 1);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(x + nx * w, y + ny * w);
    ctx.quadraticCurveTo(x + dx * len * 0.5 * k + nx * w * 0.9, y + dy * len * 0.5 * k + ny * w * 0.9, x + dx * len * k + nx * R * 0.05, y + dy * len * k + ny * R * 0.05);
    ctx.quadraticCurveTo(x + dx * len * 0.5 * k - nx * w * 0.9, y + dy * len * 0.5 * k - ny * w * 0.9, x - nx * w, y - ny * w);
    ctx.closePath(); ctx.fill();
  }
}

/** 쌍성: 짝 몸체가 궤도 0(1.75)을 돈다(깊이로 앞뒤), 도구 때 둘 사이 입자 다리 */
function drawTwin(view, ctx, v, x, y, R, alpha, T, pass, tk, tm) {
  const po = v._po; if (!po || !po.spec.rings[0]) return;
  const rg = po.spec.rings[0], th = po.th[0];
  const o = orbitPoint(rg.a, rg.e, th, {}), p = projOrbit(o.x, o.z, rg.inc, rg.node, {});
  if ((p.d < 0) !== (pass === 0)) return;
  const cx = x + p.x * R, cy = y + p.y * R, cr = R * 0.48;
  if (tk > 0.2 && pass === 1) {
    ctx.fillStyle = T.twin;
    for (let j = 0; j < 4; j++) { const u = ((tm * 1.4 + j / 4) % 1); ctx.globalAlpha = alpha * tk * 0.8 * Math.sin(u * Math.PI); ctx.fillRect(x + (cx - x) * u - 1, y + (cy - y) * u - 1, 2, 2); }
  }
  ctx.globalAlpha = alpha * (pass ? 1 : 0.8); ctx.fillStyle = T.twin;
  ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.fill();
  ctx.globalAlpha = alpha * 0.28; ctx.fillStyle = '#000000';
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.clip(); ctx.beginPath(); ctx.arc(cx + cr * 0.6, cy + cr * 0.6, cr * 1.1, 0, TAU); ctx.fill(); ctx.restore();
}

/** 균열 선(단위 원 안, 시드 고정): [[x0,y0,x1,y1,...], ...] */
function cracksOf(id) {
  const out = [];
  for (let k = 0; k < 5; k++) {
    let a = hash01(id, 'ca' + k) * TAU, r = 0.15 + 0.5 * hash01(id, 'cr' + k);
    let px = Math.cos(a) * r, py = Math.sin(a) * r;
    const line = [px, py];
    let dir = hash01(id, 'cd' + k) * TAU;
    for (let i = 0; i < 5; i++) {
      dir += (hash01(id, 'cw' + k + i) - 0.5) * 1.6;
      px += Math.cos(dir) * 0.22; py += Math.sin(dir) * 0.22;
      if (px * px + py * py > 0.95) break;
      line.push(px, py);
    }
    if (line.length >= 4) out.push(line);
  }
  return out;
}
function cratersOf(id) {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(hash01(id, 'kx' + i) * 2.2 - 1.1, hash01(id, 'ky' + i) * 1.6 - 0.8, 0.08 + 0.12 * hash01(id, 'ks' + i));
  return out;
}

// ---------------- 뚜르비용(2D) — 위에서 본 동심 링: 바깥 케이지(살 3·블루 스크루)·안쪽 케이지(점선·루비 피벗)·밸런스 휠(금빛 테·살·타이밍 나사)·
// 이스케이프 휠(톱니, 째깍)·앵커. 서브는 단일 케이지 링 + 살 3(째깍). 박자는 tourbillon-core.mjs Escapement(3D 와 같음).
const TB2 = {
  dark: { steel: '#a9b3c1', gold: '#c9a65c', ruby: '#c0183c', blue: '#3f6cff' },
  light: { steel: '#5f6a7a', gold: '#8a6a28', ruby: '#9e0f2c', blue: '#2346c4' },
};
function escOf(v, now, reduced) {
  const e = v._esc || (v._esc = new Escapement(hash01(v.id, 'tourb')));
  const dt = Math.min(0.25, Math.max(0, now - (v._escT ?? now))); v._escT = now;
  e.step(dt, planetMode(v.node.status, v.icons ? v.icons.size : 0, !!v.scopeRecent), { reduced });
  return e;
}
/** main = 다축(메인), 아니면 단일 케이지(서브). R = 몸체 화면 반지름 */
export function drawTourb2D(view, ctx, v, x, y, R, alpha, now, main) {
  if (R < (main ? 6 : 10)) return;
  const L = !!view.tokens.isLight, P = L ? TB2.light : TB2.dark, e = escOf(v, now, !!view.reduced);
  const fine = R >= (main ? 14 : 18);
  const lw = Math.max(0.8, R * (main ? 0.035 : 0.028));
  const dot = (px, py, r, c, a) => { ctx.globalAlpha = alpha * a; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); };
  ctx.save();
  if (!main) {
    const Rc = R * TG.SUB_R;
    ctx.globalAlpha = alpha * 0.7; ctx.strokeStyle = P.steel; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(x, y, Rc, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < TG.SUB_ARMS; i++) { const a = e.cage + (i * TAU) / TG.SUB_ARMS; ctx.moveTo(x + Math.cos(a) * R * 1.04, y + Math.sin(a) * R * 1.04); ctx.lineTo(x + Math.cos(a) * Rc, y + Math.sin(a) * Rc); }
    ctx.stroke();
    if (fine) { const a = e.cage; dot(x + Math.cos(a) * Rc, y + Math.sin(a) * Rc, Math.max(1.2, R * 0.05), P.ruby, 0.95); for (let i = 1; i < TG.SUB_ARMS; i++) { const b = e.cage + (i * TAU) / TG.SUB_ARMS; dot(x + Math.cos(b) * Rc, y + Math.sin(b) * Rc, Math.max(1, R * 0.035), P.blue, 0.9); } }
    ctx.restore(); ctx.globalAlpha = alpha; return;
  }
  const Ro = R * TG.OUTER_R, Ri = R * TG.INNER_R, Rb = R * TG.BAL_R;
  // 바깥 케이지: 링 + 살 3(케이지 각으로 째깍) + 살 끝 블루 스크루
  ctx.globalAlpha = alpha * 0.75; ctx.strokeStyle = P.steel; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y, Ro, 0, TAU); ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < TG.OUTER_ARMS; i++) { const a = e.cage + (i * TAU) / TG.OUTER_ARMS; ctx.moveTo(x + Math.cos(a) * Rb * 1.05, y + Math.sin(a) * Rb * 1.05); ctx.lineTo(x + Math.cos(a) * Ro, y + Math.sin(a) * Ro); }
  ctx.stroke();
  // 안쪽 케이지: 점선 링이 반대로 돌고 피벗 루비 둘
  if (fine) {
    ctx.globalAlpha = alpha * 0.6; ctx.setLineDash([Math.max(2, R * 0.14), Math.max(1.5, R * 0.07)]); ctx.lineDashOffset = -e.cage2 * Ri;
    ctx.beginPath(); ctx.arc(x, y, Ri, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    for (const k of [0, Math.PI]) dot(x + Math.cos(e.cage2 + k) * Ri, y + Math.sin(e.cage2 + k) * Ri, Math.max(1.2, R * 0.045), P.ruby, 0.95);
  }
  // 밸런스 휠: 금빛 테 + 살 3 토막 + 타이밍 나사(진동)
  ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = P.gold; ctx.lineWidth = lw * 1.3;
  ctx.beginPath(); ctx.arc(x, y, Rb, 0, TAU); ctx.stroke();
  if (fine) {
    const a0 = e.cage + e.bal;
    ctx.beginPath();
    for (let i = 0; i < TG.BAL_SPOKES; i++) { const a = a0 + (i * TAU) / TG.BAL_SPOKES; ctx.moveTo(x + Math.cos(a) * R * 1.0, y + Math.sin(a) * R * 1.0); ctx.lineTo(x + Math.cos(a) * Rb, y + Math.sin(a) * Rb); }
    ctx.stroke();
    for (let i = 0; i < TG.BAL_SCREWS; i++) { const a = a0 + ((i + 0.5) * TAU) / TG.BAL_SCREWS; dot(x + Math.cos(a) * (Rb + R * 0.045), y + Math.sin(a) * (Rb + R * 0.045), Math.max(0.9, R * 0.03), P.gold, 0.95); }
    for (let i = 0; i < TG.OUTER_ARMS; i++) { const a = e.cage + (i * TAU) / TG.OUTER_ARMS; dot(x + Math.cos(a) * Ro, y + Math.sin(a) * Ro, Math.max(1, R * 0.035), P.blue, 0.95); }
    // 이스케이프 휠(케이지에 붙어 감): 톱니가 박마다 째깍 + 앵커
    const ea = e.cage + Math.PI / TG.OUTER_ARMS, ex = x + Math.cos(ea) * Ro, ey = y + Math.sin(ea) * Ro, er = R * TG.ESC_R * 1.1;
    ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = P.gold; ctx.lineWidth = Math.max(0.8, lw * 0.9);
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU);
    for (let i = 0; i < TG.ESC_TEETH; i++) { const a = -e.esc + (i * TAU) / TG.ESC_TEETH; ctx.moveTo(ex + Math.cos(a) * er, ey + Math.sin(a) * er); ctx.lineTo(ex + Math.cos(a + 0.18) * er * 1.28, ey + Math.sin(a + 0.18) * er * 1.28); }
    ctx.stroke();
    dot(ex, ey, Math.max(1, R * 0.04), P.ruby, 0.95);
    const pa = ea + e.pallet * 1.6, px = ex + Math.cos(ea) * er * 1.9, py = ey + Math.sin(ea) * er * 1.9; // 앵커 피벗(바깥쪽), 팔이 바퀴를 감쌈
    ctx.strokeStyle = P.steel; ctx.beginPath();
    ctx.moveTo(px + Math.cos(pa + 2.2) * er * 1.2, py + Math.sin(pa + 2.2) * er * 1.2); ctx.lineTo(px, py); ctx.lineTo(px + Math.cos(pa - 2.2) * er * 1.2, py + Math.sin(pa - 2.2) * er * 1.2);
    ctx.stroke();
    dot(px, py, Math.max(0.9, R * 0.035), P.ruby, 0.95);
  }
  ctx.restore(); ctx.globalAlpha = alpha;
}
