// 전체 보기 섬·건물 클릭 판정과 섬 표현 강도(순수, three 없이 시험 가능)

/** 경계 링 바깥 허용 오차(월드 단위): 링 선을 조금 벗어나 눌러도 그 섬으로 친다 */
export const islandPickTol = (r) => Math.max(1.5, r * 0.08);

/**
 * 바닥 평면 위 점(x,z) → 섬 projectId(순수). 원판 안 + 링 바깥 허용 오차까지.
 * 여러 섬이 겹치면 반지름 대비 가장 가까운(d/r 최소) 섬.
 * @param {Array<{projectId, center:{x,z}, r}>} clusters
 * @param {number} pad 허용 오차에 더할 여유(월드 단위) — 프로젝트 영역(섬 + 둘레) 판정
 */
export function pickIslandAt(clusters, x, z, pad = 0) {
  let best = null, bk = Infinity;
  for (const c of clusters) {
    if (!c || !c.center || !(c.r > 0)) continue;
    let k;
    if (c.round > 0) {
      // Planet 원형 궤도계: 반지름 기준(원 + 허용 오차 + 둘레 여유)
      const d = Math.hypot(x - c.center.x, z - c.center.z);
      if (d > c.round + islandPickTol(c.round) + pad) continue;
      k = d / c.round;
    } else if (c.box) {
      // 섬 = 경계 상자에 내접한 슈퍼타원(n=4): 그 안 + 허용 오차면 그 섬, 여럿이면 상자 대비 가까운 쪽
      const tol = islandPickTol(Math.max(c.box.hw, c.box.hd)) + pad;
      const dx = Math.abs(x - c.center.x), dz = Math.abs(z - c.center.z);
      if (dx > c.box.hw + tol || dz > c.box.hd + tol) continue;
      k = squircleK(c.box, dx, dz);
      if (k > 1 + tol / Math.max(c.box.hw, c.box.hd)) continue;
    } else {
      const d = Math.hypot(x - c.center.x, z - c.center.z);
      if (d > c.r + islandPickTol(c.r) + pad) continue;
      k = d / c.r;
    }
    if (k < bk) { bk = k; best = c.projectId; }
  }
  return best;
}

/** 섬 외곽 슈퍼타원 지수(4 = 둥근 사각, 2 = 타원). 비스듬한 카메라에서도 마름모로 보이지 않게 모서리를 크게 둥글린다 */
export const SQUIRCLE_N = 4;
/** 섬 지역 좌표 (dx, dz) 의 슈퍼타원 반지름 비(1 = 외곽선 위) */
export function squircleK(box, dx, dz, n = SQUIRCLE_N) {
  return Math.pow(Math.pow(Math.abs(dx) / box.hw, n) + Math.pow(Math.abs(dz) / box.hd, n), 1 / n);
}

/** 섬 모서리 반지름(예전 둥근 사각형 — 지금은 쓰지 않음, 호환용) */
export const islandCorner = (box) => Math.min(10, Math.max(2, Math.min(box.hw, box.hd) * 0.35));

/**
 * 섬 윤곽 점들(섬 지역 좌표, 시계 반대) — 경계 상자에 내접한 슈퍼타원 |x/hw|^n + |z/hd|^n = 1 (n = SQUIRCLE_N).
 * 배치·패킹은 상자 그대로, 그림만 둥글다. k = 축소 비율(안쪽 고리 0.62 등), seg = 사분원당 조각 수 기준(×2)
 * @returns [[x, z]…]
 */
export function islandOutline(box, k = 1, seg = 8, n = SQUIRCLE_N) {
  const hw = box.hw * k, hd = box.hd * k, N = Math.max(24, seg * 8), e = 2 / n;
  const out = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    out.push([hw * Math.sign(c) * Math.pow(Math.abs(c), e), hd * Math.sign(s) * Math.pow(Math.abs(s), e)]);
  }
  return out;
}

/**
 * 바닥 평면 위 점(x,z) → 건물 projectId(복셀, 순수). 직사각 bounds + pad 여유, 여럿이면 중심이 가까운 쪽
 * @param {Array<{projectId, bounds:{minX,maxX,minZ,maxZ}}>} buildings
 */
export function pickRectAt(buildings, x, z, pad = 1.5) {
  let best = null, bd = Infinity;
  for (const b of buildings) {
    const g = b && b.bounds;
    if (!g || x < g.minX - pad || x > g.maxX + pad || z < g.minZ - pad || z > g.maxZ + pad) continue;
    const d = Math.hypot(x - (g.minX + g.maxX) / 2, z - (g.minZ + g.maxZ) / 2);
    if (d < bd) { bd = d; best = b.projectId; }
  }
  return best;
}

/** 화면 좌표가 덮는 섬·건물 이름표의 projectId(이름표는 pointer-events:none 이라 사각형으로 판정) */
export function pickLabelAt(clientX, clientY, root = typeof document !== 'undefined' ? document : null) {
  if (!root) return null;
  for (const el of root.querySelectorAll('.ov-island[data-pid], .ov-bldg[data-pid]')) {
    if (el.style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width && clientX >= r.left - 2 && clientX <= r.right + 2 && clientY >= r.top - 2 && clientY <= r.bottom + 2) return el.dataset.pid;
  }
  return null;
}

/** 프로젝트 영역 여유: 섬 상자 긴 변의 15 %(최소 3) — 가장자리 노드의 라벨·홀로그램·계획 보드 자리까지 '안쪽'으로 친다 */
export const projectAreaPad = (hw, hd) => Math.max(3, Math.max(hw || 0, hd || 0) * 0.15);

/** 바쁜 섬 고리 맥동 진폭 — 경계는 거슬리지 않게: 맥동 없음 */
export const PULSE_AMP = 0;

/**
 * 섬 표현 강도(순수). 사용자 피드백 "경계가 너무 강하다": 알아볼 수만 있게 아주 옅게
 * 외곽선 0.08～0.15·얇게, 채움은 거의 투명, 바쁜 섬도 색·맥동으로 튀지 않게(ringMix 로 배경 쪽에 섞음).
 * @returns {{disc:number, ring:number, inner:number, ringMix:number, hot:boolean}}
 */
export function islandStyle({ inactive = false, hot = false, dimmed = false, light = false } = {}) {
  const dk = dimmed ? 0.5 : 1;
  return {
    disc: (inactive ? (light ? 0.05 : 0.035) : (light ? 0.08 : 0.055)) * dk,
    ring: (inactive ? (light ? 0.09 : 0.08) : hot ? (light ? 0.15 : 0.14) : (light ? 0.13 : 0.11)) * dk,
    inner: (light ? 0.06 : 0.05) * dk,
    ringMix: 0.3,
    hot: !!hot && !inactive,
  };
}

/** 파이 구역선 끝: 구역 중심(cx, cz)에서 방향 a 로 섬 상자 가장자리(pad 안쪽)까지 거리 */
export function zoneRayLen(box, cx, cz, a, pad = 1.5) {
  const ux = Math.cos(a), uz = Math.sin(a);
  const tx = Math.abs(ux) > 1e-6 ? (ux > 0 ? box.hw - pad - cx : box.hw - pad + cx) / Math.abs(ux) : Infinity;
  const tz = Math.abs(uz) > 1e-6 ? (uz > 0 ? box.hd - pad - cz : box.hd - pad + cz) / Math.abs(uz) : Infinity;
  return Math.max(0, Math.min(tx, tz));
}
