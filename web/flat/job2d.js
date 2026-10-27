// 작업(Job) 노드 2D 그리기 — 흐름 2D 알약 · Planet 2D 작은 위성.
//   색 = job-core jobCode(job, view.clock())(재생 중엔 가상 시계) — 진행 호박 · 대기 파랑 흐림 · 줄 섬 회색 흐림 · 끝 초록 · 실패 빨강 · 정체 주황.
//   진행 비율(jobProgress)이 있으면 막대·호로 채우고, 모르면 왕복 토막·도는 호. 대기는 재확인 시각(until) 쪽으로 차오르는 고리,
//   정체는 끊긴 심박(박동 셋에 하나가 빠짐)·점선 테두리, 끝·실패는 움직임 없이 차분하게.
// 저사양 경로: 프레임마다 객체·문자열을 만들지 않는다 — 표시 상태는 v._js 에 담아 CODE_S(0.25초)마다만 다시 재고,
// 팔레트는 테마 토큰 객체가 바뀔 때만 다시 만든다. 순수 규칙(크기·색·채움·맥박)은 flat-core.mjs(시험 web/test/jobs-flat.test.mjs).
import { jobOf, jobCode, jobProgress } from '../job-core.mjs';
import { JOB2D, JOB_ALPHA, jobAnim, jobPalette, jobPill, jobOrbitArc, jobWaitFill, jobStalePulse, jobMarquee, jobBeatY, mixColor } from './flat-core.mjs';
import { rrect } from './flat-draw.js';
import { JOB_BODY_K, JOB_GLYPH, jobWeightK, TRACK, trackSlots, trackSpan, trackRadius, trackModel, trackLabels } from '../planet-core.mjs'; // 무게·글리프·항로(3D 와 같은 규칙)

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;
const PILL = {};
const MQ = [0, 0];
const BEAT_N = 16; // 끊긴 심박 선의 점 수

/** 작업 노드인가(그리기 갈래용 — meta.job 이 있으면) */
export const isJobVis = (v) => !!(v && v.node && v.node.meta && v.node.meta.job);

/**
 * 작업 vis 의 표시 상태 캐시(v._js): 작업 내용(상태·박동·재확인·진행)이 바뀌면 진행·대기 기준을 다시,
 * 표시 상태(정체 판정 — 시계에 달림)는 CODE_S 마다 view.clock() 으로 다시 잰다.
 */
export function syncJob(view, v, now) {
  const job = jobOf(v.node);
  if (!job) return null;
  let js = v._js;
  if (!js) js = v._js = { ref: null, st: null, beat: null, until: null, prog: null, at: -1e9, code: 1, p: -1, wait: -1, untilMs: NaN, fromMs: NaN };
  if (js.ref !== job || js.st !== job.state || js.until !== job.until || js.prog !== job.progress || js.beat !== job.beatAt) {
    const nowMs = view.clock();
    const enterWait = job.state === 'waiting' && (js.st !== 'waiting' || js.until !== job.until);
    js.ref = job; js.st = job.state; js.until = job.until; js.prog = job.progress; js.beat = job.beatAt;
    const pr = jobProgress(job);
    js.p = pr == null ? -1 : pr;
    if (job.state === 'waiting') {
      const u = Date.parse(job.until || '');
      js.untilMs = Number.isFinite(u) ? u : NaN;
      if (enterWait) { const b = Date.parse(job.beatAt || ''); js.fromMs = Math.min(Number.isFinite(b) ? b : nowMs, nowMs); }
    } else { js.untilMs = NaN; js.fromMs = NaN; }
    js.at = -1e9;
  }
  if (now - js.at >= JOB2D.CODE_S) {
    js.at = now;
    const nowMs = view.clock();
    js.code = jobCode(job, nowMs);
    js.wait = js.code === 2 ? jobWaitFill(nowMs, js.fromMs, js.untilMs) : -1;
  }
  return js;
}

/**
 * 프레임 갱신(_updateExtra 에서): 보이는 작업의 표시 상태를 맞추고 움직임 등급을 돌려준다.
 * 1 = 진행·정체(15fps 배경 움직임), 대기 고리만 있으면 WAIT_REDRAW_S 마다 한 번 다시 그림. 상태가 바뀌면 다시 그림.
 */
export function jobLevel(view, now) {
  let lv = 0, wait = false;
  for (const v of view.vis.values()) {
    if (v.gone || v.hidden || !isJobVis(v)) continue;
    const js = syncJob(view, v, now);
    if (!js) continue;
    if (v._jcode !== js.code) { v._jcode = js.code; view.dirty = true; }
    if (!view.reduced && jobAnim(js.code)) lv = 1;
    else if (js.code === 2 && js.wait >= 0 && js.wait < 1) wait = true;
  }
  if (wait && now - (view._jobWaitAt || 0) >= JOB2D.WAIT_REDRAW_S) { view._jobWaitAt = now; view.dirty = true; }
  return lv;
}

/** 팔레트(표시 상태 0..5 → 색, 흐린 몸체 색) — 테마 토큰 객체가 바뀔 때만 다시 만든다 */
function pal(view) {
  if (view._jpTok !== view.tokens) {
    view._jpTok = view.tokens;
    const c = jobPalette(view.tokens);
    view._jp = { c, dim: c.map((x) => mixColor(x, view.tokens.bg || '#000000', view.tokens.isLight ? 0.55 : 0.6)) };
  }
  return view._jp;
}

/** 알약 왼쪽 상태 글리프(gx, gy 가운데, 반지름 gr) */
function glyph(ctx, code, gx, gy, gr, col, a, js, now, seed, reduced, pulse) {
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = Math.max(1, gr * 0.42);
  if (code === 1) { // 진행: 채운 점(숨쉬기)
    const k = reduced ? 1 : 0.82 + 0.18 * Math.sin(now * 4 + seed * 6);
    ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(gx, gy, gr * k, 0, TAU); ctx.fill();
  } else if (code === 2) { // 대기: 시계 고리 — 재확인 시각(until) 쪽으로 차오름(12시가 재확인)
    ctx.globalAlpha = a * 0.3; ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.stroke();
    if (js.wait >= 0) {
      if (js.wait > 0.005) { ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(gx, gy, gr, TOP, TOP + js.wait * TAU); ctx.stroke(); }
    } else { // 시각 없는 대기: 바늘 하나(천천히)
      const h = reduced ? 0 : now * 0.8 + seed;
      ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(TOP + h) * gr * 0.8, gy + Math.sin(TOP + h) * gr * 0.8); ctx.stroke();
    }
  } else if (code === 3) { // 끝: 체크
    ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(gx - gr * 0.75, gy); ctx.lineTo(gx - gr * 0.15, gy + gr * 0.6); ctx.lineTo(gx + gr * 0.8, gy - gr * 0.6); ctx.stroke();
  } else if (code === 4) { // 실패: ×
    const q = gr * 0.65;
    ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(gx - q, gy - q); ctx.lineTo(gx + q, gy + q); ctx.moveTo(gx + q, gy - q); ctx.lineTo(gx - q, gy + q); ctx.stroke();
  } else if (code === 5) { // 정체: 끊긴 고리(맥박에 맞춰 밝아짐)
    ctx.globalAlpha = a * pulse; ctx.beginPath(); ctx.arc(gx, gy, gr, TOP + 0.5, TOP + TAU - 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(gx, gy, gr * 0.3, 0, TAU); ctx.fill();
  } else { // 줄 섬: 빈 점
    ctx.globalAlpha = a * 0.8; ctx.beginPath(); ctx.arc(gx, gy, gr * 0.8, 0, TAU); ctx.stroke();
  }
}

/**
 * 흐름 2D 작업 칩: 백그라운드 명령 육각보다 작은 알약. 왼쪽 상태 글리프 · 오른쪽 진행 막대(정체면 끊긴 심박 선).
 * (x, y) 가운데·R 칩 반지름(px)·alpha = 퇴장·전체 보기 희미 몫.
 */
export function drawJobPill(view, ctx, v, x, y, R, alpha, now) {
  const js = v._js || syncJob(view, v, now);
  if (!js) return;
  const code = js.code, J = pal(view), col = J.c[code], L = view.tokens.isLight, P = view.P;
  const a = alpha * JOB_ALPHA[code];
  if (a < 0.01) return;
  const stale = code === 5;
  const pulse = stale ? jobStalePulse(now, v.seed, view.reduced) : 1;
  if (R < JOB2D.DOT_PX) { // 먼 칩: 가로 점 하나
    ctx.globalAlpha = a * (stale ? 0.4 + 0.6 * pulse : 1); ctx.fillStyle = col; ctx.fillRect(x - 1.5, y - 1, 3, 2); ctx.globalAlpha = 1;
    return;
  }
  const pl = jobPill(R, PILL), w = pl.w, h = pl.h, x0 = x - w / 2, y0 = y - h / 2;
  const foc = v.id === view.focusId || v.id === view.hoverId;
  if ((code === 1 || foc) && R > 5) { // 옅은 번짐(진행·포커스만)
    rrect(ctx, x0 - 2, y0 - 2, w + 4, h + 4, pl.rad + 2);
    ctx.globalAlpha = a * (foc ? 0.3 : 0.13); ctx.fillStyle = col; ctx.fill();
  }
  rrect(ctx, x0, y0, w, h, pl.rad);
  ctx.globalAlpha = a * (L ? 0.92 : 0.88); ctx.fillStyle = P.interior; ctx.fill();
  if (code === 3 || code === 4) { ctx.globalAlpha = a * 0.12; ctx.fillStyle = col; ctx.fill(); } // 끝·실패: 옅게 물든 몸체(차분하게)
  ctx.globalAlpha = a * (stale ? 0.45 + 0.55 * pulse : 1);
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, R * (foc ? 0.17 : 0.1));
  const dashed = stale || code === 0;
  if (dashed) ctx.setLineDash(stale ? [Math.max(2.5, R * 0.7), Math.max(1.5, R * 0.35)] : [Math.max(1.5, R * 0.3), Math.max(1.5, R * 0.3)]);
  ctx.stroke();
  if (dashed) ctx.setLineDash([]);
  if (R < JOB2D.DETAIL_PX) { ctx.globalAlpha = 1; return; }
  glyph(ctx, code, x0 + h / 2, y, h * 0.27, col, a, js, now, v.seed, view.reduced, pulse);
  // 진행 막대(글리프 오른쪽)
  const bx0 = x0 + h * 0.95, bx1 = x0 + w - h * 0.45, bw = bx1 - bx0;
  const bh = Math.max(1.5, h * 0.2), by = y - bh / 2;
  if (bw < 3) { ctx.globalAlpha = 1; return; }
  if (stale) { // 끊긴 심박 선 + (있으면) 흐린 진행
    if (js.p >= 0) { ctx.globalAlpha = a * 0.25; ctx.fillStyle = col; ctx.fillRect(bx0, by, bw * js.p, bh); }
    ctx.globalAlpha = a * (0.5 + 0.5 * pulse); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, R * 0.08);
    const amp = h * 0.3;
    ctx.beginPath();
    for (let i = 0; i <= BEAT_N; i++) {
      const u = i / BEAT_N, px = bx0 + bw * u;
      const py = y - (view.reduced ? 0 : jobBeatY(u, now, v.seed)) * amp;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    if (view.reduced) ctx.setLineDash([bw * 0.3, bw * 0.12]);
    ctx.stroke();
    if (view.reduced) ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = a * 0.22; ctx.fillStyle = L ? '#64748b' : '#94a3b8'; ctx.fillRect(bx0, by, bw, bh); // 막대 바탕
  ctx.fillStyle = col;
  if (code === 1) {
    if (js.p >= 0) { ctx.globalAlpha = a; ctx.fillRect(bx0, by, Math.max(1, bw * js.p), bh); }
    else { // 비율 모름: 왕복 토막
      const m = view.reduced ? (MQ[0] = 0, MQ[1] = 0.3, MQ) : jobMarquee(now, v.seed, MQ);
      ctx.globalAlpha = a * 0.9; ctx.fillRect(bx0 + bw * m[0], by, bw * (m[1] - m[0]), bh);
    }
  } else if (code === 3) { ctx.globalAlpha = a * 0.55; ctx.fillRect(bx0, by, bw, bh); }
  else if (code === 4) { ctx.globalAlpha = a * 0.6; ctx.fillRect(bx0, by, bw * (js.p >= 0 ? Math.max(0.05, js.p) : 1), bh); }
  else if (js.p >= 0) { ctx.globalAlpha = a * 0.55; ctx.fillRect(bx0, by, bw * js.p, bh); } // 대기·줄 섬: 지난 진행만 흐리게
  ctx.globalAlpha = 1;
}

/**
 * Planet 2D 작업 = 주인 둘레 아주 작은 위성: 주인 중심 궤도 흔적 호(점선) · 작은 구 · 둘레 진행 호
 * (진행 = 비율만큼 호박 호, 모르면 도는 짧은 호 · 대기 = 12시(재확인) 쪽으로 차오르는 파랑 호 · 정체 = 끊긴 점선 고리 맥박 ·
 *  끝 = 초록 고리 · 실패 = 빨강 고리). owner = 주인 vis(없으면 궤도 흔적 생략).
 */
export function drawJobMoon(view, ctx, v, x, y, R, alpha, now, owner) {
  const js = v._js || syncJob(view, v, now);
  if (!js) return;
  const code = js.code, J = pal(view), col = J.c[code];
  const a = alpha * JOB_ALPHA[code];
  if (a < 0.01) return;
  const stale = code === 5;
  const pulse = stale ? jobStalePulse(now, v.seed, view.reduced) : 1;
  R *= jobWeightK(jobOf(v.node), view.clock()) / JOB_BODY_K; // G2 오래 돈 만큼 무게(배치 반지름은 그대로)
  if (R < JOB2D.DOT_PX * 0.8) { ctx.globalAlpha = a * (stale ? 0.4 + 0.6 * pulse : 1); ctx.fillStyle = col; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.globalAlpha = 1; return; }
  // 궤도 흔적: 주인 둘레를 도는 위성처럼(주인–작업 거리 반지름, 작업 각도 ±ORBIT_ARC) — 항로 자리의 작업은 drawJobTracks 가 항로로
  if (owner && owner._sp && !owner.hidden && !owner.gone && !(view._jobSlots && view._jobSlots.has(v.id))) {
    const ox = owner._sp.x, oy = owner._sp.y, dx = x - ox, dy = y - oy, rr = Math.hypot(dx, dy);
    if (rr > R * 3) {
      const an = Math.atan2(dy, dx), ha = jobOrbitArc(rr);
      ctx.globalAlpha = a * 0.28; ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(ox, oy, rr, an - ha, an + ha); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // 몸체: 흐린 상태색 구 + 상태색 테두리 + 작은 밝은 점(빛 받는 쪽)
  ctx.globalAlpha = a; ctx.fillStyle = J.dim[code];
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, R * 0.16); ctx.stroke();
  if (R >= JOB_GLYPH.PX) glyphPlanet(ctx, code, x, y, R * 0.62, col, view.tokens.isLight, a, js.wait, pulse); // G1 상태 글리프
  else if (R > 3) { ctx.globalAlpha = a * 0.75; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x - R * 0.32, y - R * 0.32, R * 0.32, 0, TAU); ctx.fill(); }
  // 둘레 호
  const ro = R * 1.75, lw = Math.max(1.2, R * 0.3);
  ctx.lineWidth = lw; ctx.strokeStyle = col;
  if (code === 1 || code === 2 || code === 0) { ctx.globalAlpha = a * 0.18; ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke(); } // 바탕 고리
  if (code === 1) {
    ctx.globalAlpha = a;
    if (js.p >= 0) { if (js.p > 0.003) { ctx.beginPath(); ctx.arc(x, y, ro, TOP, TOP + js.p * TAU); ctx.stroke(); } }
    else { const a0 = view.reduced ? TOP : now * 2.2 + v.seed * 6; ctx.beginPath(); ctx.arc(x, y, ro, a0, a0 + 1.1); ctx.stroke(); }
  } else if (code === 2) {
    if (js.wait > 0.003) { ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, ro, TOP, TOP + js.wait * TAU); ctx.stroke(); }
    ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - ro, lw * 0.75, 0, TAU); ctx.fill(); // 12시 = 재확인 표지
  } else if (code === 3) { ctx.globalAlpha = a * 0.6; ctx.lineWidth = Math.max(1, lw * 0.6); ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke(); }
  else if (code === 4) { ctx.globalAlpha = a * 0.85; ctx.lineWidth = Math.max(1, lw * 0.7); ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke(); }
  else if (stale) {
    ctx.globalAlpha = a * (0.35 + 0.65 * pulse); ctx.setLineDash([Math.max(2, ro * 0.5), Math.max(2, ro * 0.35)]);
    ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    if (js.p >= 0 && js.p > 0.003) { ctx.globalAlpha = a * 0.3; ctx.beginPath(); ctx.arc(x, y, ro, TOP, TOP + js.p * TAU); ctx.stroke(); }
  }
  const foc = v.id === view.focusId || v.id === view.hoverId;
  if (foc) { ctx.globalAlpha = 0.85; ctx.strokeStyle = view.tokens.text; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, ro + lw + 2, 0, TAU); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

/**
 * G1 Planet 2D 상태 글리프(3D·흐름 jobTop 과 같은 여섯 — 점 셋 · 재생 삼각 · 모래시계 · 체크 · 엑스 · 느낌표). gr = 글리프 반지름(px).
 * 다크 = 밝은 상태색 + 어두운 받침, 라이트 = 진한 상태색 + 흰 받침.
 */
function glyphPlanet(ctx, code, gx, gy, gr, col, L, a, wf, pulse) {
  ctx.globalAlpha = a * 0.6; ctx.fillStyle = L ? '#ffffff' : '#05080f';
  ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.fill();
  const ink = L ? mixColor(col, '#000000', 0.35) : mixColor(col, '#ffffff', 0.25);
  ctx.globalAlpha = a; ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, gr * 0.24); ctx.lineCap = 'round';
  const q = gr * 0.62;
  ctx.beginPath();
  if (code === 1) { ctx.moveTo(gx - q * 0.55, gy - q * 0.75); ctx.lineTo(gx + q * 0.8, gy); ctx.lineTo(gx - q * 0.55, gy + q * 0.75); ctx.closePath(); ctx.fill(); }
  else if (code === 2) { // 모래시계: 위 모래가 until 쪽으로 줄어듦
    const f = wf >= 0 ? wf : 0.5;
    ctx.moveTo(gx - q * 0.6, gy - q); ctx.lineTo(gx + q * 0.6, gy - q); ctx.lineTo(gx - q * 0.6, gy + q); ctx.lineTo(gx + q * 0.6, gy + q); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - q * 0.4 * (1 - f), gy - q * (0.9 - 0.9 * f) - q * 0.05); ctx.lineTo(gx + q * 0.4 * (1 - f), gy - q * (0.9 - 0.9 * f) - q * 0.05); ctx.lineTo(gx, gy); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(gx - q * 0.5 * f, gy + q * 0.9); ctx.lineTo(gx + q * 0.5 * f, gy + q * 0.9); ctx.lineTo(gx, gy + q * (0.9 - 0.8 * f)); ctx.closePath(); ctx.fill();
  } else if (code === 3) { ctx.moveTo(gx - q * 0.75, gy); ctx.lineTo(gx - q * 0.2, gy + q * 0.55); ctx.lineTo(gx + q * 0.8, gy - q * 0.55); ctx.stroke(); }
  else if (code === 4) { const k = q * 0.62; ctx.moveTo(gx - k, gy - k); ctx.lineTo(gx + k, gy + k); ctx.moveTo(gx + k, gy - k); ctx.lineTo(gx - k, gy + k); ctx.stroke(); }
  else if (code === 5) { ctx.globalAlpha = a * pulse; ctx.moveTo(gx, gy - q * 0.85); ctx.lineTo(gx, gy + q * 0.15); ctx.stroke(); ctx.beginPath(); ctx.arc(gx, gy + q * 0.62, Math.max(0.8, gr * 0.14), 0, TAU); ctx.fill(); }
  else { for (let i = -1; i <= 1; i++) { ctx.moveTo(gx + i * q * 0.65 + gr * 0.12, gy); ctx.arc(gx + i * q * 0.65, gy, Math.max(0.8, gr * 0.12), 0, TAU); } ctx.fill(); }
  ctx.lineCap = 'butt';
}

/** 항로 자리(주인마다 끝나지 않은 작업 TRACK.PER_OWNER 개 — 3D 와 같은 trackSlots). 0.5초마다 view._jobSlots 에 */
export function jobTrackSlots(view, now) {
  if (view._jobSlots && now - (view._jobSlotsAt || -1e9) < 0.5 && now >= view._jobSlotsAt) return view._jobSlots;
  view._jobSlotsAt = now;
  const items = [];
  for (const v of view.vis.values()) {
    if (v.gone || v.hidden || !isJobVis(v)) continue;
    items.push({ id: v.id, owner: v.node.parentId, job: jobOf(v.node) });
  }
  return (view._jobSlots = trackSlots(items));
}

/**
 * 안 A Planet 2D 항로(노드 아래 층): 위에서 본 원 항로 — 주인 중심 · 반지름 = 주인–작업 거리(궤도계 안쪽이면 바깥으로).
 * 지나온 항로 = 탐사선 쪽으로 굵고 진해지는 항적(예상 비율이면 점선) · 남은 항로 = 옅은 점선 · 도착·출발 관문(작은 고리) · 관문 글자(분 단위).
 * 대기 = 앞쪽 12칸 눈금이 until 쪽으로 · 비율 모름 = 전체 흐린 점선 + 혜성 꼬리 · 정체 = 식은 항적 · 끝·실패 = 그리지 않음(탐사선만).
 * ownerExt(v) = 주인 궤도계 겉 반지름(px), 분리 프로세스 아래 계기는 건너뜀(skip(v)).
 */
export function drawJobTracks(view, ctx, now, s, ownerExt, skip) {
  const slots = jobTrackSlots(view, now);
  if (!slots.size) return;
  const J = pal(view), L = !!view.tokens.isLight, nowMs = view.clock();
  ctx.save();
  for (const id of slots) {
    const v = view.vis.get(id);
    if (!v || !v._on || v.hidden || v.gone || !v._sp || (skip && skip(v))) continue;
    const ov = view.vis.get(view.parentOf.get(v.id) || v.node.parentId);
    if (!ov || ov.hidden || ov.gone || !ov._sp) continue;
    const job = jobOf(v.node);
    const js = v._js || syncJob(view, v, now);
    if (!job || !js) continue;
    const code = js.code;
    const alpha = (v.scopeK ?? 1) * (v.exitF ?? 1) * (v.projA ?? 1);
    if (alpha < 0.03 || code === 0 || code === 3 || code === 4) continue;
    const ox = ov._sp.x, oy = ov._sp.y, dx = v._sp.x - ox, dy = v._sp.y - oy;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) continue;
    const rr = trackRadius(dist, ownerExt(ov) || 0);
    const m = trackModel(job, code, nowMs, rr / Math.max(1e-6, s), js.p >= 0 ? js.p : null);
    if (!(m.span > 0)) continue;
    const an = Math.atan2(dy, dx), dir = (v.seed * 7) % 2 < 1 ? 1 : -1;
    const A = (u) => an + dir * (u - m.p) * m.span; // u = 0 출발 · 1 도착
    const col = J.c[code];
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round';
    // 남은 항로(옅은 점선) — 대기는 12칸 눈금
    if (m.mode === 'wait') {
      for (let k = 0; k < 12; k++) {
        const u0 = m.p + ((1 - m.p) * (k + 0.2)) / 12, u1 = m.p + ((1 - m.p) * (k + 0.8)) / 12, lit = (k + 0.5) / 12 <= (m.wait ?? 0);
        ctx.globalAlpha = alpha * (lit ? 0.85 : TRACK.REMAIN_A * 0.8); ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(ox, oy, rr, Math.min(A(u0), A(u1)), Math.max(A(u0), A(u1))); ctx.stroke();
      }
    } else {
      ctx.globalAlpha = alpha * TRACK.REMAIN_A * (m.mode === 'spin' ? 0.8 : 1); ctx.lineWidth = 1.2; ctx.setLineDash([2, 4]);
      if (m.mode === 'spin') ctx.lineDashOffset = view.reduced ? 0 : -now * 6;
      ctx.beginPath(); ctx.arc(ox, oy, rr, Math.min(A(m.mode === 'spin' ? 0 : m.p), A(1)), Math.max(A(m.mode === 'spin' ? 0 : m.p), A(1))); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    // 지나온 항로(항적): 탐사선 쪽으로 굵고 진하게 — 비율 모름은 혜성 꼬리 한 토막, 예상 비율은 점선, 정체는 식은 색
    const wakeFrom = m.mode === 'spin' ? Math.max(0, m.p - 0.14) : 0;
    if (m.p > wakeFrom + 1e-3) {
      const N = 10;
      if (m.mode === 'est') ctx.setLineDash([5, 4]);
      ctx.strokeStyle = m.mode === 'stale' ? mixColor(col, L ? '#8a6a58' : '#a08878', 0.55) : col;
      for (let i = 0; i < N; i++) {
        const u0 = wakeFrom + ((m.p - wakeFrom) * i) / N, u1 = wakeFrom + ((m.p - wakeFrom) * (i + 1)) / N, k = (i + 1) / N;
        ctx.globalAlpha = alpha * (m.mode === 'wait' ? 0.3 : 0.22 + 0.78 * Math.pow(k, 1.5)) * (m.mode === 'stale' ? 0.7 : 1);
        ctx.lineWidth = m.mode === 'wait' ? 1.2 : 1.2 + 2.6 * Math.pow(k, 1.4);
        ctx.beginPath(); ctx.arc(ox, oy, rr, Math.min(A(u0), A(u1)), Math.max(A(u0), A(u1))); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // 관문(작은 고리) + 글자(분 단위로만 바뀜)
    const gr = Math.max(2.5, Math.min(6, (v._R || 4) * 0.6));
    for (const [u, k] of [[0, 0.45], [1, 0.85]]) {
      if (m.mode === 'spin' && u === 1) continue;
      const gx = ox + Math.cos(A(u)) * rr, gy = oy + Math.sin(A(u)) * rr;
      ctx.globalAlpha = alpha * k; ctx.lineWidth = 1.6; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.stroke();
    }
    if ((v._R || 0) >= 4) {
      const tl = v._tl || (v._tl = { at: -1e12, code: -1, lab: null });
      if (nowMs - tl.at >= 60000 || tl.code !== code || nowMs < tl.at) { tl.at = nowMs; tl.code = code; tl.lab = trackLabels(job, m, nowMs); }
      ctx.font = '600 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (const [u, text, k] of [[0, tl.lab.from, 0.7], [1, tl.lab.to, 0.95]]) {
        if (!text) continue;
        const gx = ox + Math.cos(A(u)) * rr, gy = oy + Math.sin(A(u)) * rr - gr - 3;
        const w = ctx.measureText(text).width + 8;
        ctx.globalAlpha = alpha * k * 0.85; ctx.fillStyle = L ? 'rgba(255,255,255,0.88)' : 'rgba(6,12,22,0.75)';
        rrect(ctx, gx - w / 2, gy - 13, w, 14, 4); ctx.fill();
        ctx.globalAlpha = alpha * k; ctx.fillStyle = col; ctx.fillText(text, gx, gy);
      }
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
