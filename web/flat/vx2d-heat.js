// 복셀 2D 평면도 과열 — 3D 와 같은 은유를 위에서 본 모습으로: 붉은 열기 번짐·테(위험이면 맥동), 땀 점, 김·연기 퍼프(화면 위쪽으로 떠오름),
//   불티·김 분출·한숨 입김, 얼굴 붉어짐. 규칙·입자 배치는 voxel/vx-heat-core.mjs(3D 와 같은 함수), 장부는 voxel2d.js 의 TiredBook.
import { TIRED, heatParticles, glowLevel, flushOf, heatHueOf, bodyTintOf, floorHeatOf } from '../voxel/vx-heat-core.mjs';
import { mixHex } from '../voxel/vx-job-core.mjs';

const PARTS = Array.from({ length: TIRED.PART_CAP }, () => ({ type: '', x: 0, y: 0, z: 0, s: 0, a: 0, r: 0 }));
const COL = {
  dark: { heat: '#ff3b2f', warm: '#ffa63a', steam: '#dde3ee', smoke: '#868b97', burst: '#f2f5fa', breath: '#e6f0ff', sweat: '#9fd8ff', ember: '#ffa040', flush: '#e0503c' },
  light: { heat: '#e0311f', warm: '#e8850f', steam: '#8a93a6', smoke: '#23262e', burst: '#a7b0c2', breath: '#9aa6bd', sweat: '#2f8fe0', ember: '#f05a14', flush: '#d8402e' },
};
const FWD = [0, 0.03, 0.1, 0.16]; // 구부정: 머리가 앞으로 나온 정도(어깨 원 반지름 배)

/** 머리 앞으로 나온 정도(0.42 기본에 더함) */
export function headLean(h) {
  if (!h || !h.on) return 0;
  return FWD[h.stage] + (h.act === 'slump' ? 0.12 * Math.sin(Math.min(1, h.k) * Math.PI) : 0);
}
/** 얼굴 색(피부 hex → 붉게) */
export function flushSkin(skin, h, isLight) {
  const f = flushOf(h);
  return f > 0 ? mixHex(skin, (isLight ? COL.light : COL.dark).flush, f) : skin;
}

/** 단계색(호박 → 주황 → 빨강) hex */
export function heatHex(h, isLight) {
  const C = isLight ? COL.light : COL.dark;
  return mixHex(C.warm, C.heat, heatHueOf(h));
}
/** 몸(어깨 원) 색 물듦 — 3D 옷 물듦과 같은 비율(2026-10-30 멀리서도 단계가 읽히게) */
export function heatBody(body, h, isLight) {
  const tn = h && h.on ? bodyTintOf(h) : 0;
  return tn > 0 ? mixHex(body, heatHex(h, isLight), tn) : body;
}

const FH = {};
/**
 * 몸 아래: 바닥 열기 원(데움 호박 → 과열 주황 → 위험 빨강, 은은한 맥동) — 3D 와 같은 floorHeatOf. 2026-10-30 멀리서도 보이게
 *  화면 반지름에 하한(작게 보일 때도 MIN_PX 이상)을 두고 원판(가운데 짙은 두 겹) + 테. 다크 = 더하기 빛(lighter), 라이트 = 곱하기(multiply).
 */
const MIN_PX = 9;
export function drawHeatUnder(ctx, ch, x, y, R, now, reduced, isLight, alpha) {
  const h = ch._heat;
  if (!h || !h.on || h.stage < 1) return;
  const fh = floorHeatOf(h, now, reduced, ch.phase || 0, FH);
  if (!(fh.a > 0)) return;
  const col = heatHex(h, isLight);
  const rr = Math.max(R * (1.15 + 0.62 * fh.r), MIN_PX + 5 * fh.r); // 데움 ≈ R×2 · 위험 ≈ R×2.4
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = isLight ? 'multiply' : 'lighter';
  ctx.fillStyle = col;
  ctx.globalAlpha = alpha * 0.2 * fh.a;
  ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = alpha * 0.22 * fh.a;
  ctx.beginPath(); ctx.arc(x, y, rr * 0.68, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = alpha * 0.75 * fh.ring;
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.4, rr * 0.07 * fh.w);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
  if (fh.rings > 1) { ctx.globalAlpha = alpha * 0.5 * fh.ring; ctx.beginPath(); ctx.arc(x, y, rr * 1.24, 0, Math.PI * 2); ctx.stroke(); } // 위험 = 테 두 겹
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
}

/**
 * 몸 위: 붉은 테(위험)·이마 땀 점·흩날리는 땀·김·연기·불티·분출·입김. hx,hy = 머리 화면 좌표, s = 화면 px/단위, dv = 바라보는 방향(yawVec).
 */
export function drawHeatOver(ctx, ch, x, y, hx, hy, R, s, dv, now, reduced, isLight, alpha) {
  const h = ch._heat;
  if (!h || !h.on) return;
  const C = isLight ? COL.light : COL.dark;
  if (h.stage >= 3) {
    const gl = glowLevel(h, now, reduced, ch.phase || 0);
    ctx.globalAlpha = alpha * (0.55 + 0.4 * gl);
    ctx.strokeStyle = C.heat; ctx.lineWidth = Math.max(1.2, R * 0.14);
    ctx.beginPath(); ctx.arc(x, y, R * (1.18 + (reduced ? 0 : 0.06 * gl)), 0, Math.PI * 2); ctx.stroke();
  }
  if (R > 4) { // 이마 땀 점(데움 1 · 과열↑ 2, 2026-10-30 크게 R×0.09 → 0.13)
    ctx.globalAlpha = alpha * 0.95; ctx.fillStyle = C.sweat;
    const nd = h.stage >= 2 ? 2 : 1;
    for (let i = 0; i < nd; i++) {
      const sd = i ? -1 : 1;
      ctx.beginPath(); ctx.arc(hx + dv.x * R * 0.28 - dv.z * R * 0.22 * sd, hy + dv.z * R * 0.28 + dv.x * R * 0.22 * sd, Math.max(1.3, R * 0.13), 0, Math.PI * 2); ctx.fill();
    }
  }
  const n = heatParticles(h, ch.hash || 0, now, reduced, PARTS);
  if (!n) { ctx.globalAlpha = alpha; return; }
  const rx = -dv.z, rz = dv.x; // 오른쪽
  for (let i = 0; i < n; i++) {
    const p = PARTS[i];
    const sy2 = Math.max(s, 22); // 작게 보일 때도 김이 머리에서 떨어져 보이게(높이 하한)
    const px = hx + (p.x * rx + p.z * dv.x) * s, py = hy + (p.x * rz + p.z * dv.z) * s - p.y * sy2 * 0.55; // 높이 = 화면 위쪽
    const small = p.type === 'steam' || p.type === 'smoke' || p.type === 'burst';
    const pr = small ? Math.max(2.2, p.s * s * 0.6) : Math.max(0.8, p.s * s * 0.6); // 김·연기는 작게 보일 때도 덩이로(2026-10-30)
    switch (p.type) {
      case 'steam': case 'smoke': case 'burst': case 'breath':
        ctx.globalAlpha = alpha * Math.min(1, p.a * 1.6);
        ctx.fillStyle = C[p.type];
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
        break;
      case 'sweat':
        ctx.globalAlpha = alpha; ctx.fillStyle = C.sweat;
        ctx.beginPath(); ctx.arc(px, py, Math.max(0.9, pr * 0.8), 0, Math.PI * 2); ctx.fill();
        break;
      case 'ember':
        ctx.globalAlpha = alpha * Math.max(0.3, p.a); ctx.fillStyle = C.ember;
        ctx.fillRect(px - pr * 0.6, py - pr * 0.6, pr * 1.2, pr * 1.2);
        break;
    }
  }
  ctx.globalAlpha = alpha;
}
