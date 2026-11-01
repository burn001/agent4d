// 【모듈 규격 · 기자재(equipment) 담당】 연구 기자재 3D(three) — 기존 동적 BoxBatch 에 채움(새 그리기 호출 0). 모델·모양은 lab-rig-core.mjs.
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ buildRigRingStatic(room, pal, b, o): room.lab.rigSlots(빈 칸 바닥 표시) · b = 정적 {lit, glow, glass}                       │
// │ drawRig(pos, st, pal, tok, B, node, nowMs):                                                                            │
// │   pos = layout.machine 값 {x, y:0, z, type:'rig'|'batch', slot, face(중심을 보는 yaw), theta, rigKind, shelf?, scale?}      │
// │   st  = VoxelView 기계 상태 묶음 {status(runVisStatus), runStale, flash 0..1, appear 0..1, t(초), seed, id}               │
// │         선택(리드가 채우면 더 정확): ix(rigIxOf 세부) · lift 0..1(승강판, rigLiftK) · far(멀면 LOD 6 상자) ·                │
// │         standby(재무장 대기 = 렌즈 덮개) · band·progress·running(시퀀서 = deviceInfo)                                     │
// │   B   = 동적 {lit, glow} · tok = 테마 토큰 · node = 앱 노드 · nowMs = 렌더러 시계(재생 = 가상)                              │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 ─ export ──────────────────────────────────────────────────────────────────────────────────┐
// │ buildRigRingStatic(room, pal, b, o)   고리 바닥 표시(빈 칸 패드 + 승강판 테두리) — 정적                                     │
// │ drawRig(pos, st, pal, tok, B, node, nowMs) → 그린 상자 수. 기자재 한 대(종류 RIG_KINDS × 상태 RIG_STATES), ≤ 40(+승강판 10), 멀면 6 │
// │ drawRigVacant(slot, k, pal, B)   퇴장 뒤 비워 둔 자리: 회색 판 + 테두리 4변 + 가운데 X(k 0..1 = 남은 비율) — 동적 7 상자      │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 성능 상한(LAB_PERF): 기자재당 상자 ≤ 40(멀면 6) + 승강판 ≤ 10, 전체 ≤ 1,800 동적 상자, 갱신 < 1.0ms/프레임(플랫폼과 합). 프레임마다 할당 0.
import * as THREE from 'three';
import { LAB } from './lab-const.mjs';
import { RIG_HEX, RIG_KIND_HEX, rigModel, rigParts } from './lab-rig-core.mjs';

const _c = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
const HEX = { dark: {}, light: {} };
for (const th of ['dark', 'light']) for (const [k, v] of Object.entries(RIG_HEX[th])) HEX[th][k] = new THREE.Color(v);
const KHEX = { dark: {}, light: {} }; // 종류 악센트(색 키 'kind')
for (const th of ['dark', 'light']) for (const [k, v] of Object.entries(RIG_KIND_HEX[th])) KHEX[th][k] = new THREE.Color(v);
const _parts = [], _model = {};

export function buildRigRingStatic(room, pal, b, o = {}) {
  const lab = room && room.lab;
  if (!lab) return;
  const k = o.dim ? 0.55 : 1;
  const base = k === 1 ? pal.mat : pal.mat.clone().multiplyScalar(k);
  const rim = HEX[pal.isLight ? 'light' : 'dark'].trim.clone().multiplyScalar(k);
  const S = LAB.RIG.SIZE;
  for (const s of lab.rigSlots) {
    b.lit.box(s.x, 0.012, s.z, S, 0.02, S, base, s.face);
    // 승강판 테두리(퇴장 때 내려가는 판의 이음매) — 앞·뒤 두 줄
    const fx = Math.sin(s.face), fz = Math.cos(s.face);
    b.lit.box(s.x + fx * (S / 2 - 0.04), 0.024, s.z + fz * (S / 2 - 0.04), S - 0.1, 0.012, 0.05, rim, s.face);
    b.lit.box(s.x - fx * (S / 2 - 0.04), 0.024, s.z - fz * (S / 2 - 0.04), S - 0.1, 0.012, 0.05, rim, s.face);
  }
}

/** 퇴장 뒤 비워 둔 자리(VACANT_S 동안): 회색 판(0.04) + 테두리 4변 + 가운데 X 두 막대(발광, k 비례). k = 남은 비율(0 이면 안 그림) — 상자 7 */
export function drawRigVacant(slot, k, pal, B) {
  if (!(k > 0) || !slot) return 0;
  const H = HEX[pal.isLight ? 'light' : 'dark'], a = slot.face || 0, ca = Math.cos(a), sa = Math.sin(a);
  const S = LAB.RIG.SIZE * 0.9, e = S / 2 - 0.04, w = 0.07;
  _c.copy(H.stop).multiplyScalar(0.45 + 0.4 * k);
  B.lit.box(slot.x, 0.02, slot.z, S, 0.04, S, _c, a);
  _c.copy(H.stop).lerp(WHITE, pal.isLight ? 0.05 : 0.3).multiplyScalar(0.3 + 0.7 * k);
  for (let i = 0; i < 4; i++) { // 테두리 4변(지역 앞·뒤·좌·우)
    const lx = i < 2 ? 0 : (i === 2 ? e : -e), lz = i < 2 ? (i === 0 ? e : -e) : 0;
    B.glow.box(slot.x + lx * ca + lz * sa, 0.05, slot.z - lx * sa + lz * ca, i < 2 ? S : w, 0.02, i < 2 ? w : S - 2 * w, _c, a);
  }
  const xl = S * 0.9; // X: 대각선 두 막대
  B.glow.box(slot.x, 0.052, slot.z, xl, 0.02, w, _c, a + Math.PI / 4);
  B.glow.box(slot.x, 0.052, slot.z, xl, 0.02, w, _c, a - Math.PI / 4);
  return 7;
}

/**
 * 기자재 한 대. 모양 목록은 lab-rig-core rigParts(지역 좌표, +z = 앞 = 중심 쪽)를 기자재 자리·방향으로 옮겨 lit/glow 묶음에 넣는다.
 * 나타남(appear) = 아래에서 솟음 · 퇴장(lift) = 승강판째 바닥 아래로 내려감(표시등은 마지막까지) · 보조 선반 = scale 0.6.
 */
export function drawRig(pos, st, pal, tok, B, node, nowMs) {
  const H = HEX[pal.isLight ? 'light' : 'dark'], L = B.lit, G = B.glow, a = pos.face || 0;
  const kind = pos.rigKind || (pos.type === 'batch' ? 'sequencer' : 'meter');
  const M = rigModel(node, kind, nowMs, st.ix || null, st, _model);
  M.flash = st.flash || 0; M.rearmWait = !!st.standby;
  const sc = pos.scale || 1;
  const lift = Math.max(0, Math.min(1, st.lift || 0));
  M.scale = sc; M.lift = lift;
  const n = rigParts(M, st.t || 0, _parts, !!st.far, st.seed || 0);
  const KC = KHEX[pal.isLight ? 'light' : 'dark'][M.kind] || H.kind;
  const appear = Math.max(0.02, st.appear == null ? 1 : st.appear);
  const sy = sc * appear, dy = -lift * 2.1 * sc; // 내려감: 최고 높이(H_MAX) 만큼
  const ca = Math.cos(a), sa = Math.sin(a), id = st.id; // 집기(pick) 주인 = 노드 id — 동적 lit 묶음만 집힌다
  const fl = st.flash > 0 ? st.flash * 0.5 : 0;
  for (let i = 0; i < n; i++) {
    const p = _parts[i];
    const lx = p.x * sc, lz = p.z * sc;
    const wx = pos.x + lx * ca + lz * sa, wz = pos.z - lx * sa + lz * ca;
    let wy = p.y * sy + dy;
    if (lift > 0 && p.g) wy = Math.max(wy, p.y * sy - lift * 0.6); // 표시등은 마지막까지 바닥 위에 남음
    if (wy + (p.sy * sy) / 2 < -0.02) continue;          // 바닥 아래로 다 들어간 상자
    const base = p.c === 'kind' ? KC : H[p.c] || H.body;
    if (p.g) {
      _c.copy(base).multiplyScalar(Math.max(0.08, Math.min(1, p.k)));
      if (p.k > 1) _c.lerp(WHITE, Math.min(0.6, (p.k - 1) * 0.5));
      if (fl) _c.lerp(WHITE, fl);
      G.box(wx, wy, wz, p.sx * sc, p.sy * sy, p.sz * sc, _c, a + p.r);
    } else {
      L.box(wx, wy, wz, p.sx * sc, p.sy * sy, p.sz * sc, base, a + p.r, id);
    }
  }
  let m = n;
  if (lift > 0) m += drawLiftPlate(pos, sc, a, lift, M.state, st.t || 0, H, B);
  return m;
}

/**
 * 승강판(퇴장 중): 바닥 높이 어두운 판 + 4변 호박 경고 띠(변마다 2 토막이 흘러 호박/검정 교차, 발광) + 판 위 상태색 표시등 기둥. 상자 10
 */
function drawLiftPlate(pos, sc, a, lift, state, t, H, B) {
  const S = LAB.RIG.SIZE * sc, e = S / 2 - 0.05 * sc, ca = Math.cos(a), sa = Math.sin(a);
  B.lit.box(pos.x, 0.02, pos.z, S, 0.03, S, H.panel, a);
  const k = 0.55 + 0.6 * (1 - lift), seg = S * 0.3, ph = (t * 0.9) % 1;
  _c.copy(H.run).multiplyScalar(Math.min(1, k));
  if (k > 1) _c.lerp(WHITE, (k - 1) * 0.4);
  for (let i = 0; i < 4; i++) {
    const side = i < 2; // 앞·뒤 변(지역 x 방향) / 좌·우 변(지역 z 방향)
    const fixed = (i % 2 ? -e : e);
    for (let j = 0; j < 2; j++) {
      const u = (((ph + j * 0.5) % 1) - 0.5) * (S - seg - 0.1 * sc); // 변을 따라 흐름
      const lx = side ? u : fixed, lz = side ? fixed : u;
      B.glow.box(pos.x + lx * ca + lz * sa, 0.045, pos.z - lx * sa + lz * ca, side ? seg : 0.09 * sc, 0.03, side ? 0.09 * sc : seg, _c, a);
    }
  }
  const col = H[state] || H.stop, ch = 0.6 * (1 - 0.5 * lift);
  _c.copy(col).multiplyScalar(state === 'stop' ? 0.6 : 1);
  const cw = Math.max(0.12, 0.12 * sc); // 보조 선반도 세계 0.12 이상
  B.glow.box(pos.x, 0.035 + ch / 2, pos.z, cw, ch, cw, _c, a);
  return 10;
}
