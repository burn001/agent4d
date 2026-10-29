// Planet 2D 관계선 — 레이저 통신 링크 ⇄ 궤도 공명 고리(3D planet-links.js 의 Canvas 판).
//  · 레이저: 궤도계 바깥끼리 가는 선 + 흐르는 대시를 박자만 바꿔 펄스로(작업 중 촘촘·빠름, 대기 2초마다 핑 하나, 완료 = 꺼지고 점선 안내선,
//    오류 = 끊기는 빨강, 중지 = 회색 고정). claude -p = 평행선 둘(금색 이중 빔). 양 끝 작은 접시(상대 쪽으로 벌어진 컵).
//  · 궤도 고리: 부모 중심·자식을 지나는 원호(자식 쪽 약 90°, 꼬리로 갈수록 옅음) + 흐르는 대시(밝기 흐름). 2D 는 내려다보기 지도라
//    궤도면이 원으로 보인다(3D 의 약간 기운 원호와 같은 자리). claude -p = 자기 초점 금색 점선 호 + 부모에서 초점까지 옅은 실.
//  · 띄움: 레이저 = 가끔 번쩍이는 점선, 궤도 = 기동기 곁 짧은 점선 호. 모드·무게는 3D 와 같은 시계(plinks-core.mjs plinksMix).
import { PLINKS, stateKey, stepState, laserLook, orbitLook, endGaps } from '../plinks-core.mjs';
import { toScreen, mixColor } from './flat-core.mjs';
import { isGuessLink } from '../batch-core.mjs';
import { DEG, degOf, lineFlicker, brokenDash } from '../degrade-core.mjs';
import { hash01 } from '../planet-core.mjs';
import { orbitExtent } from './planet-orbits2d.js';

const DG_DASH = [0, 0, 0, 0];

/** 노드 궤도계 겉 반지름(화면 px) — 카드 기준점(_cardAnchor)과 같은 식 */
export function outerPx(v) { return (v._R || 0) * (v._po ? Math.max(1, Math.min(orbitExtent(v), 3.4) * 0.9) : 1); }

/** 링크 색(문자열 캐시): 종류·세션·상태 섞임을 단계로 끊어 캐시 */
function linkColor(view, cv, S, t) {
  const cp = cv.kind === 'claude-p';
  const base = cp ? view.kindColor('claude-p') : cv.sessC || t.link;
  const q = (x) => Math.round(x * 10);
  const key = base + '|' + q(S.done) + q(S.stop) + q(S.err) + t.bg;
  const c = cv._pl2c;
  if (c && c.key === key) return c.col;
  let col = base;
  if (S.done > 0.05) col = mixColor(col, mixColor(col, t.bg, 0.55), S.done * 0.85);
  if (S.stop > 0.05) col = mixColor(col, t.stopped, S.stop * 0.8);
  if (S.err > 0.05) col = mixColor(col, t.error, S.err * 0.85);
  cv._pl2c = { key, col };
  return col;
}

/** 대시 펄스: 길이 len(px) 경로에 rep 개, 위상 ph(경로 단위) → setLineDash·offset */
function pulseDash(ctx, len, rep, ph, headK) {
  const per = Math.max(6, len / Math.max(1, rep));
  const on = Math.max(2, per * headK);
  ctx.setLineDash([on, per - on]);
  ctx.lineDashOffset = -(((ph % 1) + 1) % 1) * per + on;
}

/** 그리기: Planet2DView._drawScene 이 연결 층에서 부른다. mix = plinksMix 결과 */
export function drawPlanetLinks2D(view, ctx, now, s, mix) {
  const t = view.tokens;
  const wO = mix.w, wL = 1 - wO;
  const red = !!view.reduced;
  const dt = Math.min(0.5, Math.max(0, now - (view._pl2Last || now))); view._pl2Last = now;
  const a = {}, b = {}, A = {}, B = {};
  const lw = Math.max(1, Math.min(2.2, s * 0.06));
  ctx.save();
  ctx.lineCap = 'round';
  for (const [cv, pv] of view.links) {
    if (cv.gone || pv.gone || cv.hidden || pv.hidden) continue;
    if (!cv._on && !pv._on) continue;
    const st = cv.node.status;
    const S = cv._plS = stepState(cv._plS, stateKey(st, st === 'error' && (cv.stale || (cv.node.meta && cv.node.meta.job))), dt);
    if (cv._plSeed == null) cv._plSeed = hash01(cv.id, 'pl');
    const seed = cv._plSeed;
    const sk = cv.scopeK ?? 1, sD = cv.scopeD ?? sk;
    let m = (sD < 1 ? 0.2 + 0.8 * sD : 1) * (cv.projA ?? 1);
    if (cv.exitF < 1) m *= cv.exiting != null ? 1 - 0.65 * (1 - cv.exitF) : cv.exitF;
    const dg = DEG.on ? degOf(cv.id) : 0, tt = DEG.reduced ? 0 : DEG.t, sd = dg > 0 ? (cv.seed * 1e6) | 0 : 0;
    if (dg > 0) m *= lineFlicker(sd, tt, dg);
    if (m < 0.02) continue;
    toScreen(view.cam, view.W, view.H, pv.pos.x, pv.pos.z, a);
    toScreen(view.cam, view.W, view.H, cv.pos.x, cv.pos.z, b);
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 2) continue;
    const [ga, gb] = endGaps(d, outerPx(pv), outerPx(cv));
    const keep = cv._linkK > 0 ? Math.max(0, 1 - cv._linkK) : 1;
    const col = linkColor(view, cv, S, t);
    const cp = cv.kind === 'claude-p', guess = isGuessLink(cv.node);
    ctx.strokeStyle = col;
    // ---- 레이저 ----
    if (wL > 0.01) {
      const L = laserLook(S, d / Math.max(1, s), now, seed, red);
      const ux = dx / d, uy = dy / d;
      A.x = a.x + ux * ga; A.y = a.y + uy * ga;
      const len = Math.max(1, d - ga - gb);
      B.x = A.x + ux * len * keep; B.y = A.y + uy * len * keep;
      const offs = cp ? [Math.max(1.6, lw * 1.3), -Math.max(1.6, lw * 1.3)] : [0];
      for (const o of offs) {
        const ox = -uy * o, oy = ux * o;
        // 빔 바탕
        ctx.globalAlpha = Math.min(1, L.a * 1.6) * m * wL;
        ctx.lineWidth = cp ? Math.max(1, lw * 0.75) : lw;
        if (guess) ctx.setLineDash([6, 5]); else if (dg > 0) ctx.setLineDash(brokenDash(sd, tt, dg, Math.max(3, s * 0.4), DG_DASH)); else ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(A.x + ox, A.y + oy); ctx.lineTo(B.x + ox, B.y + oy); ctx.stroke();
        // 펄스(흐르는 대시)
        if (L.p > 0.02 && !guess) {
          ctx.globalAlpha = Math.min(1, L.p) * m * wL;
          ctx.lineWidth = (cp ? lw : lw + 0.8);
          pulseDash(ctx, len, L.rep, L.ph + (o < 0 ? 0.5 : 0), S.act > 0.5 ? 0.14 : 0.07);
          ctx.beginPath(); ctx.moveTo(A.x + ox, A.y + oy); ctx.lineTo(B.x + ox, B.y + oy); ctx.stroke();
          ctx.lineDashOffset = 0;
        }
      }
      if (L.guide > 0.01) { ctx.globalAlpha = L.guide * 1.5 * m * wL; ctx.lineWidth = 1; ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); }
      ctx.setLineDash([]);
      // 접시(상대 쪽으로 벌어진 작은 컵) — 너무 작으면 생략
      const cupR = Math.min(5, Math.max(2.2, s * 0.12)) * Math.min(1, wL * 1.6);
      if (cupR > 2 && sk >= 0.5) {
        ctx.globalAlpha = 0.85 * m; ctx.strokeStyle = t.isLight ? '#6b7486' : '#c9d3e6'; ctx.lineWidth = 1.4;
        const ang = Math.atan2(uy, ux);
        ctx.beginPath(); ctx.arc(A.x - ux * cupR * 0.6, A.y - uy * cupR * 0.6, cupR, ang - 1.0, ang + 1.0); ctx.stroke();
        if (keep > 0.97) { ctx.beginPath(); ctx.arc(B.x + ux * cupR * 0.6, B.y + uy * cupR * 0.6, cupR, ang + Math.PI - 1.0, ang + Math.PI + 1.0); ctx.stroke(); }
        ctx.strokeStyle = col;
      }
    }
    // ---- 궤도 공명 고리 ----
    if (wO > 0.01) {
      const O = orbitLook(S, now, seed, red);
      let cx = a.x, cy = a.y, span = PLINKS.ARC_SPAN;
      if (cp) {
        const px = -dy / d, py = dx / d, sg = seed < 0.5 ? 1 : -1;
        cx = a.x + dx * 0.45 + px * d * 0.18 * sg; cy = a.y + dy * 0.45 + py * d * 0.18 * sg;
        span = PLINKS.CP_SPAN;
        // 부모 → 초점 옅은 실
        const fx = cx - a.x, fy = cy - a.y, fd = Math.hypot(fx, fy) || 1;
        ctx.globalAlpha = 0.3 * m * wO * (1 - S.done * 0.5); ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(a.x + fx / fd * Math.min(ga, fd * 0.8), a.y + fy / fd * Math.min(ga, fd * 0.8)); ctx.lineTo(cx, cy); ctx.stroke();
        ctx.setLineDash([]);
      }
      const r = Math.hypot(b.x - cx, b.y - cy);
      if (r > 2) {
        const thc = Math.atan2(b.y - cy, b.x - cx);
        const g = Math.min(0.6, gb / r);
        const th0 = thc - g - span, th1 = th0 + span * keep;
        // 꼬리 그라데이션: 6 토막, 자식 쪽이 밝음
        const N = 6;
        ctx.lineWidth = cp ? Math.max(1, lw * 0.9) : lw;
        if (cp || guess || O.dash) ctx.setLineDash(cp ? [4, 4] : guess ? [6, 5] : [3, 5]);
        else if (dg > 0) ctx.setLineDash(brokenDash(sd, tt, dg, Math.max(3, s * 0.4), DG_DASH));
        for (let i = 0; i < N; i++) {
          const u0 = i / N, u1 = (i + 1) / N;
          if (u0 >= keep) break;
          const uu = (u0 + u1) / 2, tail = 1 + (0.1 + 0.9 * uu * uu - 1) * (O.tail ?? 1);
          ctx.globalAlpha = Math.min(1, O.a * 1.7 * tail) * m * wO;
          ctx.beginPath(); ctx.arc(cx, cy, r, th0 + span * u0, Math.min(th1, th0 + span * u1)); ctx.stroke();
        }
        // 밝기 흐름(흐르는 대시)
        if (O.p > 0.02) {
          ctx.globalAlpha = Math.min(1, O.p) * m * wO;
          ctx.lineWidth = lw + 0.6;
          pulseDash(ctx, r * span, O.rep, O.ph, 0.18);
          ctx.beginPath(); ctx.arc(cx, cy, r, th0, th1); ctx.stroke();
          ctx.lineDashOffset = 0;
        }
        ctx.setLineDash([]);
      }
    }
  }
  drawSpawn2D(view, ctx, now, wL, wO);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** 띄움: 레이저 = 가끔 번쩍이는 점선, 궤도 = 기동기 곁 짧은 점선 호 */
function drawSpawn2D(view, ctx, now, wL, wO) {
  const L = view.spawnLinks;
  if (!L || !L.length) return;
  const a = {}, b = {};
  ctx.strokeStyle = view.tokens['link-spawn'];
  ctx.lineWidth = 1.2;
  for (const [lv, sv] of L) {
    if (lv.gone || sv.gone || lv.hidden || sv.hidden) continue;
    const fade = Math.min(lv.scopeK ?? 1, sv.scopeK ?? 1) * Math.min(lv.exitF ?? 1, sv.exitF ?? 1);
    if (fade < 0.05) continue;
    toScreen(view.cam, view.W, view.H, lv.pos.x, lv.pos.z, a);
    toScreen(view.cam, view.W, view.H, sv.pos.x, sv.pos.z, b);
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 2) continue;
    const seed = hash01(sv.id, 'sp');
    const [ga, gb] = endGaps(d, outerPx(lv), outerPx(sv));
    ctx.setLineDash([3, 5]);
    if (wL > 0.01) {
      const ping = view.reduced ? 0 : Math.pow(Math.max(0, Math.sin(now * 0.9 + seed * 6)), 30);
      ctx.globalAlpha = (0.55 + 0.45 * ping) * fade * wL;
      ctx.beginPath(); ctx.moveTo(a.x + dx / d * ga, a.y + dy / d * ga); ctx.lineTo(b.x - dx / d * gb, b.y - dy / d * gb); ctx.stroke();
    }
    if (wO > 0.01) {
      const thc = Math.atan2(dy, dx), g = Math.min(0.5, gb / d);
      ctx.globalAlpha = 0.6 * fade * wO;
      ctx.beginPath(); ctx.arc(a.x, a.y, d, thc - g - PLINKS.SPAWN_SPAN, thc - g); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

/** 패킷 자리(화면): 끝은 궤도계 바깥, 레이저 = 빔 위 직선, 궤도 = 바퀴살 방향 짧은 곡선(호출 위로·결과 아래로 볼록) */
export function packetPoint2D(fv, tv, pa, pb, u, up, w, out) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1;
  const [ga, gb] = endGaps(d, outerPx(fv), outerPx(tv));
  const k = ga / d + (1 - (ga + gb) / d) * u;
  out.x = pa.x + dx * k; out.y = pa.y + dy * k;
  if (w >= 0.5) { const bump = Math.sin(Math.PI * u) * Math.min(22, d * 0.12) * (up ? -1 : 1); out.x += (-dy / d) * bump; out.y += (dx / d) * bump; }
  return out;
}
