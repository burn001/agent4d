// 흐름 2D 분리 프로세스 장치 — 흐름 3D(flowview/procrig.js)와 같은 인상의 단순판(Canvas 2D).
//   몸 = 기동기 장치와 같은 넓은 둥근 상자(테 = 과열 색 · 상태색), 왼쪽 = 도는 로터(날개 셋), 오른쪽 = 레인 숫자(한 줄이면 크게, 둘이면 두 줄),
//   아래 = 과열 눈금 6칸. 정체 = 깜빡이는 경고 점·느린 로터, 끝 = 로터가 서며 초록 정리 파동(실패 빨강·중지 회색).
//   감독 = 감독 노드 → 장치로 흐름선 위를 쓸고 가는 빛 토막(peek)·장치 둘레 점선 기다림 고리(wait)·계기 체크·되돌아오는 점.
//   진행 줄 = 장치에서 튀어나와 흐름선을 거슬러 띄운 노드로 가는 작은 호박 마름모.
// 숫자·과열·펄스 규칙은 proc-rig-core(→ job-core 공용 함수) 그대로. 프레임마다 큰 객체를 만들지 않는다(장치 메모는 vis 에).
import { RIG, rigModel, rotorTarget, spinStep, heatRgb, fmtCount, fmtCompact, tickPhase, watchFx, alarmBlink, endTone, rigEnded, rigTipHtml } from '../flowview/proc-rig-core.mjs';
import { beamControls } from '../flowview/flow-style.mjs';
import { procJobId } from '../job-core.mjs';
import { toScreen } from './flat-core.mjs';
import { MONO, rrect, setFont } from './flat-draw.js';

const TAU = Math.PI * 2;
const RGB = [0, 0, 0];
const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** 분리 프로세스 장치인가(흐름 2D 가 _nodeR·그리기 갈래에 씀) */
export const isProcVis = (v) => !!(v && v.node && v.node.meta && v.node.meta.proc && typeof v.node.meta.proc === 'object');

/** 장치 메모(로터·상태 바뀜·끝 파동) — 그릴 때마다 모델과 함께 갱신 */
function memo(v) { return v._rig2 || (v._rig2 = { spin: {}, st: null, waveT: -1, tone: null, t: null, m: null, col: '#888', check: 0 }); }

/** 프레임마다(그리기 전) 모델·로터·끝 파동 갱신. 움직이는 장치가 있으면 true(15fps 배경 움직임) */
export function procLevel(view, now) {
  let anim = false;
  const nowMs = view.clock();
  for (const v of view.vis.values()) {
    if (!v.procRig || v.gone || v.hidden) continue;
    const jv = view.vis.get(procJobId(v.node));
    const m = rigModel(v.node, jv ? jv.node : null, nowMs);
    if (!m) continue;
    const R = memo(v);
    if (R.st !== m.state) { if (R.st != null && !rigEnded(R.st) && m.ended) { R.waveT = now; R.tone = endTone(m.state); } R.st = m.state; }
    const dt = R.t != null ? Math.min(0.25, Math.max(0, now - R.t)) : 0; R.t = now;
    spinStep(R.spin, rotorTarget(m.state, m.heat, view.reduced), dt);
    R.m = m;
    R.check = 0;
    const P = view.P, L = view.tokens.isLight;
    R.col = m.code === 0 ? css(heatRgb(m.heat, L, RGB)) : m.code === 1 ? P.jobStale : m.code === 2 ? P.done : m.code === 3 ? P.error : P.stopped;
    if (!view.reduced && (!m.ended || Math.abs(R.spin.w || 0) > 0.01 || R.waveT >= 0)) anim = true;
  }
  return anim;
}

/** 장치 몸(_drawChip 대신). (x, y) 가운데 · R 칩 반지름 px · alpha 퇴장·희미 몫 */
export function drawProcRig(view, ctx, v, x, y, R, alpha, now) {
  const M = v._rig2, m = M && M.m;
  if (!m) return;
  const P = view.P, L = view.tokens.isLight, col = M.col;
  const a = alpha * (m.ended ? (m.code === 2 ? 0.75 : 0.85) : 1);
  if (a < 0.01) return;
  if (R < 2.2) { ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(x - 2, y - 1.5, 4, 3); ctx.globalAlpha = 1; return; }
  const w = R * 2.9, h = R * 1.64, x0 = x - w / 2, y0 = y - h / 2;
  const foc = v.id === view.focusId || v.id === view.hoverId;
  // 달아오름: 다크 = 바깥 번짐(과열만큼), 라이트 = 몸이 잉크로 물듦
  if (m.code === 0 && m.heat > 0.05) {
    if (!L) { rrect(ctx, x0 - 3, y0 - 3, w + 6, h + 6, h * 0.24); ctx.globalAlpha = a * 0.22 * m.heat; ctx.fillStyle = col; ctx.fill(); }
  }
  rrect(ctx, x0, y0, w, h, h * 0.2);
  ctx.globalAlpha = a * (L ? 0.94 : 0.9); ctx.fillStyle = P.interior; ctx.fill();
  if (m.code === 0 && L && m.heat > 0.05) { ctx.globalAlpha = a * 0.16 * m.heat; ctx.fillStyle = col; ctx.fill(); }
  const stale = m.code === 1, blink = stale ? alarmBlink(now, view.reduced) : 1;
  ctx.globalAlpha = a * (stale ? 0.5 + 0.5 * blink : 1);
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, R * (foc ? 0.13 : 0.08));
  if (stale) ctx.setLineDash([Math.max(3, R * 0.6), Math.max(2, R * 0.3)]);
  ctx.stroke();
  if (stale) ctx.setLineDash([]);
  // 로터(왼쪽): 테 + 날개 셋
  const rr = h * 0.3, cx = x0 + h * 0.44, cy = y;
  ctx.globalAlpha = a * 0.9; ctx.lineWidth = Math.max(1, rr * 0.14);
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
  if (R > 5) {
    const an = M.spin.a || 0;
    ctx.lineWidth = Math.max(1, rr * 0.13); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { const t = an + (i * TAU) / 3; ctx.moveTo(cx + Math.cos(t) * rr * 0.22, cy + Math.sin(t) * rr * 0.22); ctx.lineTo(cx + Math.cos(t) * rr * 0.82, cy + Math.sin(t) * rr * 0.82); }
    ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, rr * 0.16, 0, TAU); ctx.fill();
  }
  // 숫자(오른쪽)
  const tx0 = x0 + h * 0.84, tx1 = x0 + w - h * 0.12, tw = tx1 - tx0;
  const ink = L ? '#0b2a44' : '#e6fbff', dim = L ? '#3d5f7a' : '#8fc3d6';
  if (R >= 7 && tw > 12) {
    ctx.textBaseline = 'middle';
    const lanes = m.lanes;
    if (R < 15 || lanes.length === 0) {
      const pv = m.primary;
      const txt = pv ? fmtCompact(pv.value) : m.ended ? (m.code === 2 ? '✓' : m.code === 3 ? '✕' : '■') : '…';
      setFont(view, ctx, `700 ${Math.round(Math.min(h * 0.46, tw / Math.max(3, txt.length) * 1.6))}px ${MONO}`);
      ctx.textAlign = 'right'; ctx.fillStyle = m.code === 0 ? ink : col; ctx.globalAlpha = a;
      ctx.fillText(txt, tx1, y - h * 0.04);
    } else {
      const n = lanes.length, rowH = (h * 0.72) / n;
      for (let i = 0; i < n; i++) {
        const l = lanes[i], ry = y0 + h * 0.08 + rowH * (i + 0.5);
        const txt = fmtCount(l.value);
        const fs = Math.max(7, Math.round(Math.min(rowH * 0.8, (tw * 0.72) / (txt.length * 0.6))));
        setFont(view, ctx, `700 ${fs}px ${MONO}`);
        ctx.textAlign = 'right'; ctx.fillStyle = m.code === 0 ? ink : col; ctx.globalAlpha = a;
        ctx.fillText(txt, tx1, ry);
        // 레인 열쇠(왼쪽, 작게) — 숫자와 겹치지 않을 만큼 자리가 있을 때만
        const kf = Math.max(7, Math.round(fs * 0.42));
        const room = tw - txt.length * 0.6 * fs - 4;
        if (R > 16 && room > kf * 3) {
          setFont(view, ctx, `500 ${kf}px ${MONO}`);
          ctx.textAlign = 'left'; ctx.fillStyle = dim; ctx.globalAlpha = a * 0.9;
          ctx.fillText(String(l.key).slice(0, Math.max(3, Math.floor(room / (kf * 0.6)))), tx0, ry);
        }
      }
    }
  }
  // 과열 눈금(아래 띠 6칸)
  if (R > 9) {
    const segs = 6, sw = (tw * 0.6) / segs, sy = y0 + h * 0.84, sh = Math.max(1.5, h * 0.07);
    for (let i = 0; i < segs; i++) {
      const on = m.heat * segs > i + 0.15;
      ctx.globalAlpha = a * (on ? 0.95 : 0.25);
      ctx.fillStyle = on ? css(heatRgb((i + 0.5) / segs, L, RGB)) : dim;
      ctx.fillRect(tx1 - (segs - i) * sw, sy, sw * 0.75, sh);
    }
  }
  // 정체 경고 점(오른쪽 위)
  if (stale) { ctx.globalAlpha = a * blink; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x0 + w - h * 0.14, y0 + h * 0.15, Math.max(1.5, h * 0.07), 0, TAU); ctx.fill(); }
  // 체크(들여다본 결과에 진행 줄)
  if (M.check > 0 && R > 6) {
    ctx.globalAlpha = Math.min(1, M.check * 1.4) * a; ctx.strokeStyle = P.done; ctx.lineWidth = Math.max(1.5, h * 0.08); ctx.lineCap = 'round';
    const kx = x0 + w - h * 0.3, ky = y0 + h * 0.16, q = h * 0.12;
    ctx.beginPath(); ctx.moveTo(kx - q, ky); ctx.lineTo(kx - q * 0.2, ky + q * 0.8); ctx.lineTo(kx + q * 1.2, ky - q * 0.9); ctx.stroke(); ctx.lineCap = 'butt';
  }
  // 끝 정리 파동
  if (M.waveT >= 0) {
    const q = (now - M.waveT) / (RIG.WAVE_MS / 1000);
    if (q >= 1 || view.reduced) M.waveT = -1;
    else { ctx.globalAlpha = alpha * (1 - q); ctx.strokeStyle = M.tone === 'error' ? P.error : M.tone === 'stopped' ? P.stopped : P.done; ctx.lineWidth = Math.max(1, R * 0.12); ctx.beginPath(); ctx.arc(x, y, w * (0.55 + 0.6 * q), 0, TAU); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}

// 화면 베지어(부모 → 자식 빔과 같은 수평 곡선): pts[4] 채움
const PA = {}, PB = {}, C1 = {}, C2 = {};
function screenBez(view, a, b) {
  toScreen(view.cam, view.W, view.H, a.x, a.z, PA);
  toScreen(view.cam, view.W, view.H, b.x, b.z, PB);
  const cp = beamControls(a, b);
  if (cp) { toScreen(view.cam, view.W, view.H, cp.c1x, cp.c1z, C1); toScreen(view.cam, view.W, view.H, cp.c2x, cp.c2z, C2); }
  else { C1.x = PA.x; C1.y = PA.y; C2.x = PB.x; C2.y = PB.y; }
}
function bezAt(t, out) {
  const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
  out.x = a * PA.x + b * C1.x + c * C2.x + d * PB.x; out.y = a * PA.y + b * C1.y + c * C2.y + d * PB.y;
  return out;
}
const Q = {};

/**
 * 감독 펄스·진행 줄 눈금 패킷(빔 위, 장치 아래 층). pulses = RigWatch.pulses(…). ticks = [{from, t0}] (Flow2DView 가 관리)
 * @returns {boolean} 그린 것이 있으면 true(다시 그려야 함)
 */
export function drawProcFx(view, ctx, now, pulses, ticks) {
  const P = view.P, L = view.tokens.isLight, s = view._s || 1;
  let any = false;
  const holo = L ? P.holoBright : P.holo;
  for (const pu of pulses || []) {
    const fv = view.vis.get(pu.from), tv = view.vis.get(pu.to);
    if (!fv || !tv || fv.gone || tv.gone || fv.hidden || tv.hidden || (!fv._on && !tv._on)) continue;
    const fx = watchFx(pu);
    const fade = Math.min(fv.exitF ?? 1, tv.exitF ?? 1) * Math.min(1, Math.min(fv.scopeK ?? 1, tv.scopeK ?? 1) * 1.3);
    if (fade < 0.05) continue;
    any = true;
    screenBez(view, fv.pos, tv.pos);
    ctx.strokeStyle = holo; ctx.fillStyle = holo;
    if (fx.thread > 0) { // 기다림 실: 흐르는 점선
      ctx.globalAlpha = fade * fx.thread * 0.8; ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]); ctx.lineDashOffset = view.reduced ? 0 : -now * 14;
      ctx.beginPath(); ctx.moveTo(PA.x, PA.y); ctx.bezierCurveTo(C1.x, C1.y, C2.x, C2.y, PB.x, PB.y); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    if (fx.sweep) { // 스캔 빛 토막: tail → head 구간을 굵고 밝게
      ctx.globalAlpha = fade * fx.sweep.alpha; ctx.lineWidth = Math.max(2, Math.min(5, s * 0.35)); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) { const t = fx.sweep.tail + ((fx.sweep.head - fx.sweep.tail) * i) / 10; bezAt(t, Q); if (i) ctx.lineTo(Q.x, Q.y); else ctx.moveTo(Q.x, Q.y); }
      ctx.stroke(); ctx.lineCap = 'butt';
      bezAt(fx.sweep.head, Q); ctx.beginPath(); ctx.arc(Q.x, Q.y, Math.max(2.5, Math.min(6, s * 0.4)), 0, TAU); ctx.fill();
    }
    if (fx.back != null) { bezAt(fx.back, Q); ctx.globalAlpha = fade; ctx.beginPath(); ctx.arc(Q.x, Q.y, Math.max(2, Math.min(5, s * 0.32)), 0, TAU); ctx.fill(); }
    if (fx.ring > 0 && tv.procRig && tv._sp) { // 기다림 고리: 장치 둘레 도는 점선
      const rr = (tv._R || 6) * 2.9 * 0.68;
      ctx.globalAlpha = fade * fx.ring * 0.75; ctx.lineWidth = Math.max(1.2, (tv._R || 6) * 0.1);
      ctx.setLineDash([Math.max(3, rr * 0.12), Math.max(2, rr * 0.1)]); ctx.lineDashOffset = view.reduced ? 0 : -now * 10;
      ctx.beginPath(); ctx.arc(tv._sp.x, tv._sp.y, rr, 0, TAU); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    if (fx.check > 0 && tv._rig2) tv._rig2.check = Math.max(tv._rig2.check, fx.check);
  }
  // 진행 줄 눈금 패킷
  const tc = L ? '#b45309' : '#ffd27a';
  for (let i = ticks.length - 1; i >= 0; i--) {
    const t = ticks[i];
    if (now < t.t0) { any = true; continue; }
    const ph = tickPhase((now - t.t0) * 1000);
    const v = view.vis.get(t.from), pv = v && view.vis.get(v.node.parentId);
    if (!ph || !v || !pv || v.gone || pv.gone || v.hidden || pv.hidden) { ticks.splice(i, 1); continue; }
    any = true;
    screenBez(view, pv.pos, v.pos);
    bezAt(ph.u, Q);
    const lift = ph.u >= 1 ? ph.pop * (v._R || 6) * 1.6 : 0;
    const r = Math.max(2.5, Math.min(5, s * 0.3));
    ctx.globalAlpha = ph.alpha * (v.exitF ?? 1); ctx.fillStyle = tc;
    ctx.beginPath(); ctx.moveTo(Q.x, Q.y - lift - r); ctx.lineTo(Q.x + r, Q.y - lift); ctx.lineTo(Q.x, Q.y - lift + r); ctx.lineTo(Q.x - r, Q.y - lift); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return any;
}

/** 마우스 올림 작은 카드(DOM .proc-tip, flowview.css) — 장치 오른쪽 */
export function procTip(view) {
  const id = view.hoverId;
  let v = id ? view.vis.get(id) : null;
  if (v && !v.procRig && v.node.parentId) { const pv = view.vis.get(v.node.parentId); if (pv && pv.procRig && procJobId(pv.node) === v.id) v = pv; }
  const show = v && v.procRig && v._rig2 && v._rig2.m && v._sp && !v.hidden && !v.gone;
  if (!show) { if (view._procTip && !view._procTip.hidden) view._procTip.hidden = true; return; }
  if (!view._procTip) {
    const el = document.createElement('div');
    el.className = 'proc-tip'; el.setAttribute('role', 'tooltip');
    (view.labelContainer || document.body).appendChild(el);
    view._procTip = el;
  }
  const el = view._procTip;
  const html = rigTipHtml(v._rig2.m, v.node);
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  el.style.setProperty('--hc', v._rig2.col);
  const w = (v._R || 6) * 2.9;
  const x = Math.min(view.W - 240, Math.max(4, v._sp.x + w / 2 + 12)), y = Math.min(view.H - 120, Math.max(4, v._sp.y - 30));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  el.hidden = false;
}
