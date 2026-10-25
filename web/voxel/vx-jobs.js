// 복셀 오피스 작업(Job) 카드 그리기 — 주인 기계에 딸린 작은 현황판의 카드 한 장.
// 자리·색 규칙은 순수 vx-job-core.mjs(2D 평면도도 같은 것), 여기는 상자(BoxBatch)로 쌓기만 한다.
// 카드 지역 축: u = 판을 보는 사람의 오른쪽, y = 위, v = 판 앞쪽. 판은 기준 방향(face)에서 카메라 쪽으로 조금 돌고(jobBoardYaw),
// 카드는 양면(뒷면은 좌우를 뒤집어 상태 띠가 늘 보는 사람 왼쪽) — 카메라가 어디 있어도 읽힌다. 돌린 방은 roomFrame 이 옮긴다.
import * as THREE from 'three';
import { JOBCARD } from './vx-job-core.mjs';

const _c = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color(), _card = new THREE.Color(), _strip = new THREE.Color(), _line = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/** 상태 열쇠 → 색(테마 토큰·팔레트). 정체 = 호박과 빨강 사이 주황 */
export function jobColor(key, tok, pal, out = _c3) {
  switch (key) {
    case 'running': return out.copy(tok.skill);
    case 'waiting': return out.copy(pal.jobWait || pal.screenOn);
    case 'queued': return out.copy(pal.jobQueue || pal.ledOff);
    case 'done': return out.copy(tok.ok);
    case 'failed': return out.copy(tok.error);
    case 'stale': return out.copy(tok.skill).lerp(tok.error, 0.45);
    default: return out.copy(tok.skill);
  }
}

/**
 * 작업 카드 한 장. m = 배치 자리 {x, y, z, face, slot, rows, lo, hi, pole},
 * st = { id, model(jobCardModel), yaw(판 방향), flash 0..1, appear 0..1, focus, ownerColor, seed }
 */
export function drawJobCard(m, st, pal, tok, b) {
  const L = b.lit, G = b.glow;
  const md = st.model;
  if (!md) return;
  const f = st.yaw ?? m.face ?? 0, fx = Math.sin(f), fz = Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f);
  const k = Math.max(0.02, st.appear ?? 1);
  const id = st.id;
  const W = JOBCARD.W, H = JOBCARD.H * k, P = JOBCARD.PITCH, BW = JOBCARD.BOARD_W;
  const cy = m.y;
  // 지역 (u, y, v) → 세계 상자
  const box = (B, u, y, v, w, h, d, c, own = null) => B.box(m.x + rx * u + fx * v, y, m.z + rz * u + fz * v, w, h, d, c, f, own);
  // 판: 뒤판 한 칸(카드마다 이어 붙여 한 장처럼) · 맨 위 머리띠(주인 종류 색) · 맨 아래 기둥(바닥 판은 받침까지)
  box(L, 0, cy, 0, BW, P + 0.004, 0.03, pal.boardFrame, id);
  if (m.hi) box(L, 0, cy + P / 2 + 0.03, 0, BW + 0.04, 0.06, 0.05, st.ownerColor || pal.boardFrame, id);
  if (m.lo && m.pole != null) {
    const top = cy - P / 2, len = top - m.pole;
    if (len > 0.01) box(L, 0, m.pole + len / 2, 0, 0.05, len, 0.05, pal.metalDark);
    if (m.pole <= 0.01) box(L, 0, 0.02, 0, 0.34, 0.04, 0.26, pal.metalDark); // 바닥 받침
    else box(L, 0, m.pole + 0.01, 0, 0.12, 0.02, 0.12, pal.metalDark);      // 기계 위 꽂이
  }
  // 포커스·호버: 판 둘레 밝은 테두리(양옆 · 위아래)
  if (st.focus) {
    const tc = tok.text, ew = BW + 0.06, eh = P + 0.04;
    box(G, -ew / 2, cy, 0, 0.02, eh, 0.05, tc); box(G, ew / 2, cy, 0, 0.02, eh, 0.05, tc);
    if (m.lo) box(G, 0, cy - eh / 2, 0, ew, 0.02, 0.05, tc);
    if (m.hi) box(G, 0, cy + eh / 2 + 0.06, 0, ew, 0.02, 0.05, tc);
  }
  // 카드 얼굴 색: 흰 카드(줄 섬·대기 = 흐림, 끝 = 조금 흐림), 상태가 바뀌면 잠깐 밝게, 정체 맥박 때 주황 물
  const sc = _c2.copy(jobColor(md.key, tok, pal, _c3));
  const card = _card.copy(pal.board);
  if (md.dim) card.lerp(pal.boardFrame, 0.35);
  else if (md.ended) card.lerp(pal.boardFrame, 0.18);
  if (md.key === 'stale' && md.lamp > 0.5) card.lerp(sc, 0.28);
  if (st.flash > 0) card.lerp(WHITE, st.flash * 0.6);
  const strip = md.key === 'stale' ? _strip.copy(sc).multiplyScalar(0.45 + 0.55 * md.lamp) : sc;
  const line2 = _line.copy(pal.boardFrame).lerp(pal.board, 0.35);
  const tl = 0.18 + ((st.seed || 0) % 7) * 0.02;
  const ru = W / 2 - 0.065;
  // 양면: s = +1 앞, −1 뒤(좌우 뒤집음)
  for (const s of [1, -1]) {
    const bx = (B, u, y, v, w, h, d, c, own) => box(B, u * s, y, v * s, w, h, d, c, own);
    bx(L, 0, cy, 0.025, W, H, 0.02, card, id);
    bx(G, -W / 2 + 0.03, cy, 0.037, 0.045, H - 0.02, 0.01, strip); // 왼쪽 상태 띠
    // 글 줄 두 개(제목·단계 흉내 — 실제 글은 이름표)
    bx(L, -W / 2 + 0.08 + tl / 2, cy + 0.045 * k, 0.037, tl, 0.026 * k, 0.006, pal.boardFrame);
    bx(L, -W / 2 + 0.15, cy + 0.008 * k, 0.037, 0.14, 0.02 * k, 0.006, line2);
    // 진행 막대(비율이 있으면): 바탕 홈 + 채움(상태 색)
    if (md.progress != null) {
      const tw = 0.4, u0 = -W / 2 + 0.07;
      bx(L, u0 + tw / 2, cy - 0.06 * k, 0.037, tw, 0.034 * k, 0.006, pal.metalDark);
      const p = Math.max(0, Math.min(1, md.progress));
      if (p > 0.005) bx(G, u0 + (tw * p) / 2, cy - 0.06 * k, 0.042, tw * p, 0.026 * k, 0.006, md.key === 'stale' ? _c.copy(sc).multiplyScalar(0.7) : sc);
    }
    if (md.wait != null) {
      // 모래시계: 위 모래 줄고 아래 모래 참(재확인 시각이 가까울수록)
      const w = md.wait, hb = 0.06 * k;
      bx(L, ru, cy + 0.075 * k, 0.045, 0.09, 0.012, 0.03, pal.metalDark);
      bx(L, ru, cy - 0.075 * k, 0.045, 0.09, 0.012, 0.03, pal.metalDark);
      bx(L, ru, cy, 0.045, 0.02, 0.02, 0.02, pal.metalDark);
      const ht = hb * (1 - w), hl = hb * w;
      if (ht > 0.003) bx(G, ru, cy + 0.012 + ht / 2, 0.047, 0.06, ht, 0.02, sc);
      if (hl > 0.003) bx(G, ru, cy - 0.068 * k + hl / 2, 0.047, 0.06, hl, 0.02, sc);
    } else {
      // 표시등: 진행 = 숨쉬기, 정체 = 끊긴 맥박, 그 밖 늘 켬
      const lc = md.lamp > 0.05 ? _c.copy(sc).multiplyScalar(0.35 + 0.65 * md.lamp) : pal.ledOff;
      bx(G, ru, cy + 0.035 * k, 0.05, 0.07, 0.07 * k, 0.03, lc);
      if (md.key === 'failed') bx(G, ru, cy - 0.05 * k, 0.05, 0.07, 0.022 * k, 0.03, sc); // 실패 = 등 아래 빨간 줄
    }
  }
}
