// 복셀 연구소(Voxel Lab, 표현 id 'lab') 공용 상수·좌표계 — 순수(three·DOM 없음). 모든 연구소 모듈(3D·2D·시험)이 여기 한 곳의 값을 쓴다.
// 설계: design-voxel-lab-20261031/design.md 대안 A(말굽 동심 호 책상 + 뒤쪽 높은 브리지). 값을 바꾸려면 리드에게 — 다른 모듈이 같이 움직인다.
//
// ┌ 좌표계 ───────────────────────────────────────────────────────────────────────────────────────┐
// │ 단위 1 ≈ 1m. 바닥 y = 0(위가 +y). 연구동 중심 = 방 원점 room.origin = room.lab.cx/cz (단일 세션은 (0, 0)).        │
// │ 방위각 θ(도) = 위에서 볼 때 중심에서 잰 각. 점 = (cx + r·sinθ, cz + r·cosθ) — polar().                            │
// │   θ 45° = 기본 카메라 쪽(복셀 cameraPrefs.azCenter 45 와 같음, 화면 오른쪽 아래) · θ 225° = 먼 쪽(브리지).        │
// │ 얼굴 방향 yaw(라디안) = 복셀 캐릭터와 같음: 바라보는 방향 (sin yaw, cos yaw). 중심을 보는 yaw = θ + π(faceIn).     │
// │ 브리지 지역 좌표 (u, v): u = 브리지 중심 반지름에서 바깥(+)으로, v = 시계 반대 접선(+). bridgeToWorld / worldToBridge │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
//
// 띠(중심에서 바깥으로, R_P = 플랫폼 반지름):
//   플랫폼 단 0..R_P(높이 0.35) → 안쪽 둘레길 R_P..+1.2 → 기자재 고리 +1.2..+4.2 → 바깥 순환 통로 +4.2..+6
//   → 책상 1열 +7(2·3열 +3.2 씩) → 브리지(바깥 책상 열 + GAP 에 앞 끝, 깊이 4, y 1.6) → 외벽(브리지 바깥 끝 + 4, 최소 26)

export const DEG = Math.PI / 180;

export const LAB = {
  /** 기본 카메라 쪽 방위(도) · 브리지 방위 θ_B(도) · 말굽 반폭(도, 책상은 θ_B ± 이 값 — 앞쪽 360 − 2×120 = 120° 열림) */
  CAM_THETA: 45,
  BRIDGE_THETA: 225,
  HORSESHOE_HALF: 120,
  /** 플랫폼(작업 대상 층 장부를 받는 원형 단). R_P = clamp(MIN + K·√(보이는 대상 수), MIN, MAX), 1단계는 DEFAULT 고정 */
  PLATFORM: { R_MIN: 7, R_MAX: 14, R_DEFAULT: 9, R_K: 0.9, H: 0.35, CORE_R: 1.6, CORE_H: 2.0, RIM_BAND: 1.6, RIM_SLOTS: 36, SECTOR_MAX: 12 },
  /** 안쪽 둘레길(직원이 플랫폼에 다가서는 자리) — R_P 에서 바깥으로 */
  INNER_WALK: 1.2,
  /** 기자재 고리: R_P + IN ～ R_P + OUT, 자리 간격 STEP(호 길이), 바닥 SIZE × SIZE, 높이 상한 H_MAX(브리지에서 플랫폼을 가리지 않게) */
  RIG: { IN: 1.2, OUT: 4.2, STEP: 2.1, SIZE: 1.4, H_MIN: 1.0, H_MAX: 2.0, SHELF_MAX: 12 },
  /** 방사 통로(기자재 고리를 끊는 문) 방위(도) — 출입문 45°·브리지 225° 포함 60° 간격, 폭 WIDTH */
  GANGWAYS: [45, 105, 165, 225, 285, 345],
  GANGWAY_WIDTH: 1.8,
  /** 바깥 순환 통로: R_P + IN ～ R_P + OUT */
  OUTER_WALK: { IN: 4.2, OUT: 6.0 },
  /** 책상 줄: 1열 반지름 R_P + ROW1, 열 간격 ROW_STEP, 책상 폭 W·깊이 D, 이웃 책상 호 간격 ARC_GAP(각 간격 = ARC_GAP / r), 최대 열 ROWS_MAX */
  DESK: { ROW1: 7, ROW_STEP: 3.2, W: 2.0, D: 0.7, ARC_GAP: 2.6, ROWS_MAX: 3, AUX_OUT: 0.9, AUX_MAX: 4 },
  /** 책상 중심 → 서는 자리(바깥쪽) 거리 = 복셀 오피스 SEAT_BACK 과 같음 */
  SEAT_BACK: 0.75,
  /** 지휘석 브리지: 바깥 책상 열 + GAP = 앞(안쪽) 끝, 폭 W(접선) × 깊이 D(반지름), 바닥 높이 Y, 경사로 폭 RAMP_W·길이 RAMP_L(덱 양 끝에서 접선 방향, 앞쪽 붙음), 난간 RAIL_H */
  BRIDGE: { GAP: 3.5, W: 10, D: 4, Y: 1.6, RAMP_W: 1.8, RAMP_L: 5, RAIL_H: 0.9, RAIL_T: 0.08, CONSOLE_W: 2.0, CONSOLE_D: 0.9, CONSOLE_U: -1.0, SEAT_U: 0.15 },
  /** 외벽: 브리지 바깥 끝 + GAP, 최소 R_MIN. 출입문 틈 DOOR_W. 원호 조각 ARCS(카메라 반대쪽 반원만 높게, 일반화) */
  WALL: { GAP: 4, R_MIN: 26, DOOR_W: 2.4, H_LOW: 0.5, H_HIGH: 2.6, ARCS: 16, HYST: 0.12 },
  /** 앞쪽 열린 공간(θ 0..90 바깥 띠) 시설 방위(도) */
  FRONT: { DOOR: 45, PORTAL: 70, LOUNGE: 15, KIOSK: 55, TOOLBOX: 25, WAIT: 38 },
  /** 앞쪽 시설의 벽 안쪽 거리(외벽 반지름에서 빼는 값) */
  FRONT_IN: { PORTAL: 1.4, LOUNGE: 3.2, KIOSK: 1.2, TOOLBOX: 1.2, WAIT: 2.4 },
  /** 플랫폼 테두리 장치 방위(도): 산출물 반출대(카메라 쪽)·DB 탱크(브리지 쪽)·원격 안테나(바깥) */
  RIM: { BOARD: [30, 60], DB: [200, 250], REMOTE: [290, 340] },
  /** 자리 예약 상한 */
  WALK: { RIM_CONCURRENT: 3, RIG_FRONT: 2, RIG_QUEUE: 2 },
};

/** 성능 상한(설계) — 각 모듈은 자기 줄을 넘지 않는다. 시험이 이 값을 읽는다 */
export const LAB_PERF = {
  DRAW_CALLS_EXTRA: 4,          // 복셀 오피스 + 플랫폼 층 4(켰을 때) + 기자재 0(동적 묶음)
  PLATFORM_BLOCKS: 300, PLATFORM_SECTOR_BOXES: 13, PLATFORM_LINES: 7000, PLATFORM_LABELS: 14, PLATFORM_LIT: 8, PLATFORM_ACTS: 160,
  RIGS_RING: 32, RIG_BOXES: 40, RIG_BOXES_FAR: 6, RIG_BOXES_TOTAL: 1800, // 멀면 6 = 종류 실루엣 3 + 종류색 띠 + 상태등 + 발광 기둥(T2)
  LAYOUT_MS_60: 5,              // computeLab 60 노드
  SECTOR_PLAN_MS_500: 8,        // labSectorPlan 대상 500
  FRAME_MS: 1.0,                // 기자재·플랫폼 갱신 / 프레임
  FLAT_EXTRA_MS: 1.5,           // 2D 갱신 1회 추가분
};

/** 연구소 카메라 — LabView 가 VoxelView.cameraPrefs 에 덮어씀 */
export const LAB_CAMERA = { fov: 32, elevMin: 34, elevMax: 60, distMin: 12, distMax: 260, minR: 10, azCenter: 45, azRange: 28, azFree: true, azShotStep: 70, idleOrbit: { spin: 2.0, minK: 0.35 } };

/** 극좌표 → 세계 {x, z}. thetaDeg = 방위(도) */
export function polar(cx, cz, r, thetaDeg, out = {}) {
  const a = thetaDeg * DEG;
  out.x = cx + r * Math.sin(a); out.z = cz + r * Math.cos(a);
  return out;
}
/** 세계 → 방위(도, 0..360) */
export function thetaOf(cx, cz, x, z) {
  const t = Math.atan2(x - cx, z - cz) / DEG;
  return t < 0 ? t + 360 : t;
}
/** 두 방위의 차(도, −180..180] */
export function dTheta(a, b) { let d = ((b - a) % 360 + 540) % 360 - 180; if (d === -180) d = 180; return d; }
/** 방위 θ 자리에서 중심을 보는 yaw(라디안) */
export const faceIn = (thetaDeg) => thetaDeg * DEG + Math.PI;
/** 방위 θ 자리에서 바깥을 보는 yaw(라디안) */
export const faceOut = (thetaDeg) => thetaDeg * DEG;

/** 플랫폼 반지름(1단계: 대상 수를 받으면 설계 공식, 없으면 기본값) */
export function platformRadius(nItems = null) {
  const P = LAB.PLATFORM;
  if (!(nItems >= 0)) return P.R_DEFAULT;
  return Math.max(P.R_MIN, Math.min(P.R_MAX, P.R_MIN + P.R_K * Math.sqrt(nItems)));
}

/**
 * 반지름 띠(순수). rP = 플랫폼 반지름, rows = 책상 열 수(1..ROWS_MAX).
 * 반환 { rP, rInner, rRigIn, rRig, rRigOut, rWalkOut, rDesk:[열별 책상 중심 반지름], rSeat:[…], rBridge(덱 중심), rBridgeIn, rBridgeOut, rWall }
 */
export function labRadii(rP = LAB.PLATFORM.R_DEFAULT, rows = 1) {
  const D = LAB.DESK, B = LAB.BRIDGE;
  rows = Math.max(1, Math.min(D.ROWS_MAX, rows | 0));
  const rDesk = Array.from({ length: rows }, (_, i) => rP + D.ROW1 + i * D.ROW_STEP);
  const rSeat = rDesk.map((r) => r + LAB.SEAT_BACK);
  const rBridgeIn = rDesk[rows - 1] + B.GAP, rBridge = rBridgeIn + B.D / 2, rBridgeOut = rBridgeIn + B.D;
  return {
    rP, rInner: rP + LAB.INNER_WALK, rRigIn: rP + LAB.RIG.IN, rRig: rP + (LAB.RIG.IN + LAB.RIG.OUT) / 2, rRigOut: rP + LAB.RIG.OUT,
    rWalkOut: rP + LAB.OUTER_WALK.OUT, rDesk, rSeat, rBridgeIn, rBridge, rBridgeOut,
    rWall: Math.max(LAB.WALL.R_MIN, rBridgeOut + LAB.WALL.GAP),
  };
}

/** 브리지 틀: 중심 c, 바깥 단위 eu, 접선 단위 ev(θ 가 커지는 쪽) */
export function bridgeFrame(cx, cz, rBridge, thetaDeg = LAB.BRIDGE_THETA) {
  const a = thetaDeg * DEG, s = Math.sin(a), c = Math.cos(a);
  return { c: { x: cx + rBridge * s, z: cz + rBridge * c }, eu: { x: s, z: c }, ev: { x: c, z: -s }, theta: thetaDeg, yawIn: faceIn(thetaDeg) };
}
export function bridgeToWorld(f, u, v, out = {}) { out.x = f.c.x + f.eu.x * u + f.ev.x * v; out.z = f.c.z + f.eu.z * u + f.ev.z * v; return out; }
export function worldToBridge(f, x, z, out = {}) { const dx = x - f.c.x, dz = z - f.c.z; out.u = dx * f.eu.x + dz * f.eu.z; out.v = dx * f.ev.x + dz * f.ev.z; return out; }

/**
 * 바닥 높이(세계 y): 브리지 덱 = BRIDGE.Y, 경사로 = 선형, 그 밖 0. f = bridgeFrame(…) (room.lab.bridge).
 * 경사로: 덱 양 끝(v = ±W/2)에서 접선 바깥으로 RAMP_L, 앞쪽(u = −D/2 ～ −D/2 + RAMP_W)
 */
export function floorYAt(f, x, z) {
  if (!f) return 0;
  const B = LAB.BRIDGE, p = worldToBridge(f, x, z, _fy);
  const hw = B.W / 2, hd = B.D / 2;
  if (p.u >= -hd && p.u <= hd && Math.abs(p.v) <= hw) return B.Y;
  if (p.u >= -hd && p.u <= -hd + B.RAMP_W) {
    const av = Math.abs(p.v);
    if (av > hw && av <= hw + B.RAMP_L) return B.Y * (1 - (av - hw) / B.RAMP_L);
  }
  return 0;
}
const _fy = { u: 0, v: 0 };
