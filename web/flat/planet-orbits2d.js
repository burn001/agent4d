// Planet 2D 궤도계(～) — planet-core.mjs orbitSpec 를 Canvas 2D 로.
//  · 궤도는 노드 둘레 3D 원·타원(기울기 inc·승교점 node)을 낮은 앙각(ELEV)으로 내려다본 투영 — 3D 와 같은 궤도 모양, 앞뒤가 생긴다.
//    몸체 전에 뒤 반쪽(깊이 < 0), 몸체 뒤에 앞 반쪽을 그려 몸체가 궤도를 가린다.
//  · 궤도선 무늬(solid·dash·dots·arcs) · 위성 점(크기·tint) · 위성 뒤 잔광 꼬리 · 메인 소행성대 · 도구 호출 때 연결선 쪽으로 튀어 나가는 입자 ·
//    완료 때 settleK 정리 연출(잠깐 밝아지며 안쪽으로 모였다 진정).
//  · 상태 세기 ORBIT(속도·밝기), LOD orbitLod(본체 화면 반지름) + ring.lod / belt.lod. 궤도 모양(단위 원)은 노드마다 한 번 계산해 둔다.
import { ORBIT, orbitSpec, orbitLod, keplerRate, orbitPoint, ringPattern, settleK, planetMode, approach, hash01, variantFamily, variantOfVis, VARIANT_EXTENT } from '../planet-core.mjs';
import { mixColor } from './flat-core.mjs';

const TAU = Math.PI * 2;
/** 궤도 투영 앙각(라디안): 납작한 궤도의 세로/가로 = sin(ELEV) ≈ 0.47 */
export const ELEV = 0.49;
const SE = Math.sin(ELEV), CE = Math.cos(ELEV);

/** 궤도면 (x, z) → 노드 공간 3D(기울기·승교점) → 화면 (sx, sy 아래로 +, d 보는 쪽 +). out 채움 */
export function projOrbit(x, z, inc, node, out) {
  const y1 = -z * Math.sin(inc), z1 = z * Math.cos(inc);
  const cn = Math.cos(node), sn = Math.sin(node);
  const x2 = x * cn + z1 * sn, z2 = -x * sn + z1 * cn;
  out.x = x2; out.y = z2 * SE - y1 * CE; out.d = z2 * CE + y1 * SE;
  return out;
}

const _p = { x: 0, y: 0, d: 0 }, _o = { x: 0, z: 0, r: 0 };

/** 단위(본체 반지름 1) 궤도 표본 n 개: [x, y, d, u] × n */
function ringGeo(rg, n) {
  const g = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    orbitPoint(rg.a, rg.e, th, _o);
    projOrbit(_o.x, _o.z, rg.inc, rg.node, _p);
    g[i * 4] = _p.x; g[i * 4 + 1] = _p.y; g[i * 4 + 2] = _p.d; g[i * 4 + 3] = i / n;
  }
  return g;
}

/** 2D LOD: 같은 문턱(orbitLod)을 본체 px × 1.35 로 — 2D 는 몸체가 원판 하나라 궤도가 더 일찍 보여도 덜 붐빔 */
export const LOD2D_K = 1.35;
export function orbitLod2d(R) { return orbitLod(R * LOD2D_K); }

export function orbitKind(v) { return v.device ? 'device' : v.kind; }

/** 노드 궤도 상태(처음 한 번 + 매 프레임 진행). 반환 po */
export function stepOrbits(view, v, now) {
  let po = v._po;
  if (!po) {
    // 서브에이전트·claude -p = 시안 궤도계(planet-variants2d.js) — 궤도 고리 없이 겉 반지름·발사점만(3D 와 같은 시안 규칙·메모)
    const vname = !v.device && variantFamily(v.kind) ? variantOfVis(v, () => { const pid = v.node.parentId, out = []; for (const w of view.vis.values()) if (w.node.parentId === pid) out.push({ id: w.id, kind: w.kind, startMs: Date.parse(w.node.startedAt) }); return out; }) : null;
    const spec = vname ? { type: null, rings: [], belt: null, extent: VARIANT_EXTENT[vname], variant: vname } : orbitSpec(orbitKind(v), v.id);
    po = v._po = { spec, last: now, cur: {}, mode: null, settleT: -1e9, emitAcc: 0, geo: new Map(),
      th: spec.rings.map((r) => r.ph), sat: [], beltA: 0, belt: null };
    if (spec.belt) {
      const b = spec.belt, P = new Float32Array(b.n * 3);
      for (let i = 0; i < b.n; i++) {
        const k = hash01(v.id, 'b' + i);
        P[i * 3] = b.r0 + (b.r1 - b.r0) * Math.pow(k, 0.8);
        P[i * 3 + 1] = hash01(v.id, 'ba' + i) * TAU;
        P[i * 3 + 2] = (hash01(v.id, 'bh' + i) - 0.5) * b.h;
      }
      po.belt = P;
    }
  }
  const dt = Math.min(0.25, Math.max(0, now - po.last)); po.last = now;
  const mode = planetMode(v.node.status, v.icons ? v.icons.size : 0, !!v.scopeRecent);
  if (po.mode !== mode) {
    if (mode === 'off' && po.mode && po.mode !== 'off') po.settleT = now;
    po.mode = mode;
  }
  const c = approach(po.cur, ORBIT[mode], dt, 2.2);
  const k = view.reduced ? 0 : 1;
  const R = po.spec.rings;
  for (let i = 0; i < R.length; i++) {
    const rg = R[i];
    po.th[i] += dt * rg.speed * rg.dir * c.speed * keplerRate(rg.e, po.th[i]) * k;
  }
  if (po.spec.belt) po.beltA += dt * po.spec.belt.speed * (0.5 + c.speed) * k;
  po.settle = settleK(now - po.settleT);
  return po;
}

/** 궤도 색(테마·노드 색) — 색 문자열은 바뀔 때만 */
function orbitColors(v, col, L) {
  if (v._poK === col + L) return v._poC;
  v._poK = col + L;
  return (v._poC = L
    ? { line: mixColor(col, '#334155', 0.35), moon: mixColor(col, '#64748b', 0.45), light: mixColor(col, '#1e293b', 0.15), spark: mixColor(col, '#0f172a', 0.3) }
    : { line: mixColor(col, '#cfe0f2', 0.45), moon: mixColor(col, '#b8bfcc', 0.6), light: mixColor(col, '#ffffff', 0.5), spark: mixColor(col, '#ffffff', 0.78) });
}
const satCol = (C, tint) => (tint < 0.42 ? C.moon : tint < 0.82 ? C.light : C.spark);

/**
 * 궤도계 그리기. pass 0 = 뒤 반쪽(몸체 전), 1 = 앞 반쪽(몸체 뒤). R = 본체 화면 반지름(px).
 * opts.spread = 궤도 반지름 배율(위성 군단 산개 등), opts.skip(i) = 이 궤도는 다른 데서 그림
 */
export function drawOrbits(view, ctx, v, x, y, R, alpha, now, col, pass, opts = {}) {
  const po = v._po; if (!po) return;
  const lod = orbitLod2d(R);
  if (!lod) return;
  const L = !!view.tokens.isLight, C = orbitColors(v, col, L);
  const c = po.cur, st = po.settle || 0;
  const scale = R * (opts.spread || 1) * (1 - 0.1 * st);
  const bright = Math.min(1.2, (c.bright ?? 0.4) + st * 0.6);
  const n = lod >= 3 ? 96 : lod === 2 ? 64 : 40;
  const lw = Math.max(0.6, Math.min(1.4, R * 0.045));
  const sats = pass === 1 ? (po.sat.length = 0, po.sat) : null;
  const rings = po.spec.rings;
  for (let i = 0; i < rings.length; i++) {
    const rg = rings[i];
    if (rg.lod > lod || (opts.skip && opts.skip(i))) continue;
    let g = po.geo.get(i * 1000 + n);
    if (!g) { g = ringGeo(rg, n); po.geo.set(i * 1000 + n, g); }
    const al = alpha * rg.alpha * (0.35 + 0.65 * bright) * (L ? 1.15 : 1) * (lod === 1 ? 1.35 : 1); // 작을 때 한 줄이라도 보이게
    if (al < 0.01) continue;
    // 궤도선(한 경로) — 이 쪽(pass) 깊이의 토막만
    ctx.globalAlpha = Math.min(1, al);
    const rot = rg.style === 'arcs' ? (now * 0.03 * rg.dir * (view.reduced ? 0 : 1)) % 1 : 0;
    if (rg.style === 'dots') {
      ctx.fillStyle = C.line;
      ctx.beginPath();
      const ds = Math.max(0.9, lw * 1.1), step = n >= 96 ? 2 : 1;
      for (let j = 0; j < n; j += step) {
        const d = g[j * 4 + 2];
        if ((d < 0) !== (pass === 0)) continue;
        ctx.rect(x + g[j * 4] * scale - ds / 2, y + g[j * 4 + 1] * scale - ds / 2, ds, ds);
      }
      ctx.fill();
    } else {
      ctx.strokeStyle = C.line; ctx.lineWidth = lw;
      ctx.beginPath();
      let pen = false;
      for (let j = 0; j < n; j++) {
        const j2 = (j + 1) % n;
        const dm = g[j * 4 + 2] + g[j2 * 4 + 2];
        const u = (j + 0.5) / n;
        const on = (dm < 0) === (pass === 0) && (rg.style === 'dash' ? j % 2 === 0 : rg.style === 'arcs' ? ringPattern('arcs', (u + rot + 1) % 1, i * 0.37) : true);
        if (!on) { pen = false; continue; }
        if (!pen) { ctx.moveTo(x + g[j * 4] * scale, y + g[j * 4 + 1] * scale); pen = true; }
        ctx.lineTo(x + g[j2 * 4] * scale, y + g[j2 * 4 + 1] * scale);
      }
      ctx.stroke();
    }
    // 위성 + 잔광
    const th0 = po.th[i];
    for (let s = 0; s < rg.sats.length; s++) {
      const sat = rg.sats[s];
      const th = th0 + sat.off;
      orbitPoint(rg.a, rg.e, th, _o); projOrbit(_o.x, _o.z, rg.inc, rg.node, _p);
      if ((_p.d < 0) !== (pass === 0)) continue;
      const sx = x + _p.x * scale, sy = y + _p.y * scale;
      const sr = Math.max(lod >= 2 ? 1.3 : 1, sat.size * R * (sat.kind === 'spark' ? 1.1 : 1));
      // 잔광: 위성 뒤 궤도 호(세 토막 점점 옅게)
      if (rg.trail > 0 && lod >= 2) {
        // 잔광: 세 토막(각 3 마디) — 위성에서 멀수록 옅게
        const span = rg.trail * TAU;
        ctx.strokeStyle = satCol(C, Math.max(0.5, sat.tint)); ctx.lineWidth = Math.min(2.2, Math.max(lw, sr * 0.45));
        let px0 = sx, py0 = sy;
        for (let g3 = 0; g3 < 3; g3++) {
          ctx.globalAlpha = Math.min(1, alpha * bright * 0.5 * (1 - g3 / 3) * (pass === 0 ? 0.6 : 1));
          ctx.beginPath(); ctx.moveTo(px0, py0);
          for (let q = 1; q <= 3; q++) {
            orbitPoint(rg.a, rg.e, th - rg.dir * span * ((g3 * 3 + q) / 9), _o); projOrbit(_o.x, _o.z, rg.inc, rg.node, _p);
            px0 = x + _p.x * scale; py0 = y + _p.y * scale; ctx.lineTo(px0, py0);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = Math.min(1, alpha * (pass === 0 ? 0.55 : 1) * (0.55 + 0.45 * bright));
      ctx.fillStyle = satCol(C, sat.tint);
      if (sat.kind === 'carrier') ctx.fillRect(sx - sr, sy - sr * 0.7, sr * 2, sr * 1.4);
      else { ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill(); }
      if (sat.kind === 'spark' && !L && lod >= 2) { // 반짝이는 위성: 작은 빛무리(두 겹, 바깥은 아주 옅게)
        ctx.globalAlpha = Math.min(1, alpha * 0.16 * bright);
        ctx.beginPath(); ctx.arc(sx, sy, Math.min(sr * 2, sr + 4), 0, TAU); ctx.fill();
        ctx.globalAlpha = Math.min(1, alpha * 0.07 * bright);
        ctx.beginPath(); ctx.arc(sx, sy, Math.min(sr * 3.2, sr + 9), 0, TAU); ctx.fill();
      }
      if (sats) sats.push(sx, sy);
    }
  }
  // 메인 소행성대(가까울 때만): 같은 앙각 투영, 천천히 돈다
  if (po.belt && lod >= po.spec.belt.lod) {
    const b = po.spec.belt, P = po.belt, nb = b.n;
    ctx.fillStyle = C.moon;
    ctx.globalAlpha = Math.min(1, alpha * (L ? 0.55 : 0.5) * (0.5 + 0.5 * bright));
    ctx.beginPath();
    const ds = Math.min(1.9, Math.max(0.8, R * 0.014));
    for (let i = 0; i < nb; i++) {
      const r = P[i * 3], a = P[i * 3 + 1] + po.beltA * (2.6 / r);
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      projOrbit(lx, lz, b.inc, b.node, _p);
      const yy = _p.y - P[i * 3 + 2] * CE;
      if ((_p.d < 0) !== (pass === 0)) continue;
      ctx.rect(x + _p.x * scale - ds / 2, y + yy * scale - ds / 2, ds, ds);
    }
    ctx.fill();
  }
  // 완료 정리 연출: 퍼지며 사라지는 얇은 고리
  if (pass === 1 && st > 0.01) {
    ctx.globalAlpha = Math.min(1, alpha * st * 0.7); ctx.strokeStyle = C.light; ctx.lineWidth = 1;
    const k = (now - po.settleT) / 1.6;
    ctx.beginPath(); ctx.ellipse(x, y, R * (1.2 + 1.6 * k), R * (1.2 + 1.6 * k) * SE, 0, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = alpha;
}

/** 지금 위성 화면 위치 중 (cx, cy) 에 가장 가까운 것(투사 빔 시작점). 없으면 null */
export function nearestSat(v, cx, cy) {
  const S = v._po && v._po.sat;
  if (!S || !S.length) return null;
  let best = -1, bd = Infinity;
  for (let i = 0; i < S.length; i += 2) { const d = (S[i] - cx) ** 2 + (S[i + 1] - cy) ** 2; if (d < bd) { bd = d; best = i; } }
  return { x: S[best], y: S[best + 1] };
}

/** 궤도계 바깥 반지름(본체 반지름 배) — 카드 자리 */
export function orbitExtent(v) { return v._po ? v._po.spec.extent : 1; }

// ---------- 도구 입자: 궤도(위성)에서 연결선 쪽으로 튀어 나감 ----------
const MAX_P = 260;
/** 입자 하나 추가. 화면 px·초 단위 */
export function burst(view, x, y, vx, vy, life, color, size = 1.4, g = 0) {
  const B = view._pb || (view._pb = []);
  if (B.length >= MAX_P) B.shift();
  B.push({ x, y, vx, vy, t0: view._pbNow || 0, life, color, size, g });
}
/** 도구 호출 중이면 위성에서 target 쪽으로 입자(초당 ORBIT.tool.emit) */
export function emitTool(view, v, R, target, col) {
  const po = v._po; if (!po || view.reduced) return;
  const now = view._pbNow || 0;
  const dt = Math.min(0.25, Math.max(0, now - (po.emitLast ?? now))); po.emitLast = now;
  const rate = po.cur.emit || 0;
  if (rate < 0.5 || orbitLod2d(R) < 2) { po.emitAcc = 0; return; }
  po.emitAcc += dt * rate;
  const S = po.sat, C = orbitColors(v, col, !!view.tokens.isLight);
  while (po.emitAcc >= 1) {
    po.emitAcc -= 1;
    let sx = v._sp.x, sy = v._sp.y;
    if (S.length) { const k = 2 * Math.floor(Math.random() * (S.length / 2)); sx = S[k]; sy = S[k + 1]; }
    let dx = target ? target.x - sx : sx - v._sp.x, dy = target ? target.y - sy : sy - v._sp.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const sp = R * (2.4 + Math.random() * 1.6), j = (Math.random() - 0.5) * 0.5;
    burst(view, sx, sy, (dx - dy * j) * sp, (dy + dx * j) * sp, 0.7 + Math.random() * 0.4, C.spark, Math.min(1.8, Math.max(0.9, R * 0.03)));
  }
}
export function drawBursts(view, ctx, now) {
  const B = view._pb;
  view._pbNow = now;
  if (!B || !B.length) return false;
  let w = 0;
  for (let i = 0; i < B.length; i++) {
    const p = B[i], k = (now - p.t0) / p.life;
    if (k >= 1 || k < 0) continue;
    B[w++] = p;
    const tt = now - p.t0;
    const px = p.x + p.vx * tt, py = p.y + p.vy * tt + 0.5 * p.g * tt * tt;
    ctx.globalAlpha = (1 - k) * (1 - k) * 0.9; ctx.fillStyle = p.color;
    const s = Math.min(2.2, p.size) * (1 - 0.5 * k);
    ctx.fillRect(px - s, py - s, s * 2, s * 2);
  }
  B.length = w;
  ctx.globalAlpha = 1;
  return w > 0;
}
