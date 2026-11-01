// 【모듈 규격 · 평면도(flat2d) 담당 — 기자재 담당과 계약 공유】 연구소 2D 기자재(원 아이콘 + 진행 호 + 상태색 테). three 0.
//
// 입력: ctx · view(Lab2DView) · machines(view.machines 중 pos.type 'rig') · nowMs(렌더러 시계)
//       모델은 web/lab/lab-rig-core.mjs 그대로: rigKindOf·rigState·rigGauge·RIG_STATE_COLOR·RIG_HEX(테마별 색)
// 출력(export):
//   drawRigs2D(ctx, view, machines, nowMs) → 움직이는 기자재가 있으면 true — 종류 글리프(⚗⚛⛁⌁◎⧗∿⚙◔▦) + 종류색 링(RIG_KIND_HEX),
//                                           상태 6색 테(굵기 max(2, 0.12·s), 실패·정체 깜빡), 진행 호(rigGauge, null 이면 도는 점).
//                                           보조 선반(pos.scale 0.6)도 같은 규칙, 반지름 하한 RIG2D_MIN_R(6px)
//   drawRigRingStatic2D(ctx, view, room)   기자재 고리 빈 칸 패드(정적 층 — 3D buildRigRingStatic 과 같은 자리)
// 쓰는 view 값: _X·_Y·_s(px/m)·_now(초, 깜빡임 시계)·reduced·tokens·vis(id → {drawS, scopeK, _sp})·focusId·hoverId
import { LAB } from '../lab/lab-const.mjs';
import { quadXZ, rigLook } from '../lab/lab2d-core.mjs';
import { RIG_KIND_HEX } from '../lab/lab-rig-core.mjs';

const FONT = '"Pretendard", "Segoe UI", "Malgun Gothic", system-ui, sans-serif';
const _q = new Array(8);

function quad(ctx, view, x, z, w, d, th) {
  quadXZ(x, z, w, d, th, _q);
  ctx.beginPath();
  ctx.moveTo(view._X(_q[0]), view._Y(_q[1]));
  for (let i = 2; i < 8; i += 2) ctx.lineTo(view._X(_q[i]), view._Y(_q[i + 1]));
  ctx.closePath();
}

/** 2D 기자재 원 반지름 하한(px) — 보조 선반·멀리 줄였을 때도 점이 되지 않게 */
export const RIG2D_MIN_R = 6;
/** 상태 테 굵기(px) = max(2, 0.12·s) */
export const rigRingW2D = (s) => Math.max(2, 0.12 * s);

/** 고리 빈 칸 패드(정적) */
export function drawRigRingStatic2D(ctx, view, room) {
  const lab = room && room.lab;
  if (!lab || !lab.rigSlots) return;
  const s = view._s, pal = view.pal;
  ctx.globalAlpha = (room._alpha ?? 1) * 0.55;
  ctx.strokeStyle = pal.mat; ctx.lineWidth = Math.max(0.6, 0.06 * s);
  const sz = LAB.RIG.SIZE;
  for (const sl of lab.rigSlots) { quad(ctx, view, sl.x, sl.z, sz, sz, sl.theta); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

/** 기자재 한 대 — 반환 true = 깜빡임·도는 점(다음 프레임 필요) */
export function drawRig2D(ctx, view, m, nowMs) {
  const p = m.pos, v = view.vis && view.vis.get(m.id);
  if (!p || p.type !== 'rig' || !v) return false;
  const s = view._s, t = view._now || 0, tok = view.tokens || {};
  const L = rigLook(m.node, p.rigKind, nowMs, !!tok.isLight, t, (m.id.length * 1.7) % 6.28, !!view.reduced);
  const k = Math.max(0.02, v.drawS || 1), A = Math.min(1, (v.scopeK ?? 1) * 1.3) * (m.removing ? 0.5 : 1);
  const x = view._X(p.x), y = view._Y(p.z), th = p.theta ?? 0;
  v._sp = v._sp || {}; v._sp.x = x; v._sp.y = y;
  const sc = p.scale > 0 ? p.scale : 1, ks = k * sc; // 보조 선반 = 0.6배
  const R = Math.max(RIG2D_MIN_R, (LAB.RIG.SIZE / 2) * s * ks);
  ctx.globalAlpha = A;
  // 몸통(고리 칸 크기, 중심을 보는 판) + 앞면 패널(중심 쪽)
  ctx.fillStyle = L.body; quad(ctx, view, p.x, p.z, 1.1 * ks, 0.9 * ks, th); ctx.fill();
  ctx.strokeStyle = L.trim; ctx.lineWidth = Math.max(0.8, 0.06 * s); ctx.stroke();
  const a = (th * Math.PI) / 180, fx = -Math.sin(a), fz = -Math.cos(a);
  ctx.fillStyle = L.panel; quad(ctx, view, p.x + fx * 0.36 * ks, p.z + fz * 0.36 * ks, 0.8 * ks, 0.12 * ks, th); ctx.fill();
  // 종류색 채움 링(원 아이콘 안쪽 테) — 작은 기자재·원경에서도 종류를 색으로 구별
  ctx.strokeStyle = RIG_KIND_HEX[tok.isLight ? 'light' : 'dark'][L.kind] || L.trim;
  ctx.lineWidth = Math.max(2, R * 0.3);
  ctx.beginPath(); ctx.arc(x, y, R * 0.72, 0, Math.PI * 2); ctx.stroke();
  // 상태 테(원): 상태색 × 깜빡임(실패·정체 = 깜빡, rigBlink)
  ctx.globalAlpha = A * Math.max(0.2, L.blink);
  ctx.strokeStyle = L.ring; ctx.lineWidth = rigRingW2D(s);
  ctx.beginPath(); ctx.arc(x, y, R * 1.05, 0, Math.PI * 2); ctx.stroke();
  // 진행 호(12시부터 시계 방향) · 모르면 도는 점(진행·대기일 때만)
  ctx.globalAlpha = A;
  if (L.gauge != null) {
    ctx.strokeStyle = L.ring; ctx.lineWidth = Math.max(2, 0.2 * s);
    ctx.beginPath(); ctx.arc(x, y, R * 1.3, -Math.PI / 2, -Math.PI / 2 + L.gauge * Math.PI * 2); ctx.stroke();
  } else if (L.state === 'run' || L.state === 'wait') {
    const ang = view.reduced ? -Math.PI / 2 : t * (L.state === 'run' ? 3 : 1);
    ctx.fillStyle = L.ring;
    ctx.beginPath(); ctx.arc(x + Math.cos(ang) * R * 1.3, y + Math.sin(ang) * R * 1.3, Math.max(1.5, 0.11 * s), 0, Math.PI * 2); ctx.fill();
  }
  // 종류 글리프(가까울 때만)
  if (s > 9) {
    ctx.fillStyle = tok.text || '#e6e6e6'; ctx.globalAlpha = A * 0.9;
    ctx.font = `600 ${Math.round(Math.max(9, Math.min(16, 0.62 * s * ks)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(L.glyph, x, y + 0.5);
  }
  // 깜빡(상태 바뀜)·포커스
  const flash = Math.max(0, Math.min(1, ((m.flashUntil || 0) - t) / 0.35));
  if (flash > 0.2 || m.id === view.focusId || m.id === view.hoverId) {
    ctx.globalAlpha = 0.9; ctx.strokeStyle = tok.text || '#fff'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, R * 1.55, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return L.anim || flash > 0;
}

/** 기자재 여럿(pos.type 'rig' 만) — 하나라도 움직이면 true */
export function drawRigs2D(ctx, view, machines, nowMs) {
  let anim = false;
  for (const m of machines || []) {
    if (!m || !m.pos || m.pos.type !== 'rig' || m.released) continue;
    const v = view.vis && view.vis.get(m.id);
    if (!v || v.projGone) continue;
    if (drawRig2D(ctx, view, m, nowMs)) anim = true;
  }
  return anim;
}
