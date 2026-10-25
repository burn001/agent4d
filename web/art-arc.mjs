// 바닥 글씨 원호 배치(순수) — Planet 원형 궤도계 섬에서 프로젝트 이름 스텐실을 섬 가장자리 원호를 따라 새긴다.
// 자리: 카메라 반대쪽(먼 쪽) 가장자리 안쪽, 눈금 띠 바로 안 — 글자 위쪽이 바깥(화면 위)을 보며 왼쪽 → 오른쪽으로 읽힘.
// 3D(art-name3d.js)는 띠 지오메트리(arcStrip)에 이름 캔버스를 입히고, 2D(flat/art-layer2d.js)는 글자마다 돌려 그린다.

/** 반지름 R 섬, 이름 캔버스 비(높이/너비) aspect, 줄 수 lines → {rc 글씨 가운데 반지름, H 글씨 띠 높이, W 원호 길이, span 각(rad)} */
export function arcNamePlate(R, aspect, lines = 1) {
  if (!(R > 0) || !(aspect > 0)) return null;
  let H = Math.min(6, Math.max(1, R * 0.1)) * Math.max(1, lines) * 1.1; // 전체 보기 먼 카메라에서도 읽히는 높이
  const inner = R * (1 - 0.06); // 30° 눈금(0.055R) 안쪽
  let rc = inner - H / 2, W = H / aspect, span = W / rc;
  const MAX = (110 * Math.PI) / 180;
  if (span > MAX) { H *= MAX / span; rc = inner - H / 2; W = H / aspect; span = W / rc; }
  if (!(rc > H)) return null;
  return { rc, H, W, span };
}

/**
 * 원호 띠(지역 좌표, 카메라 쪽 = +z). 가운데가 −z(먼 쪽)에 오고, u = 0 이 왼쪽(−x)·v = 1 이 바깥(글자 위).
 * lean = 바닥에서 바깥쪽으로 세운 각(rad, 0 = 바닥에 눕힘). 3D 는 낮은 고도 카메라에서 먼 쪽 바닥 글씨가 납작하게 눌려
 * 보이지 않으므로 세워(관측 화면 가장자리 띠처럼) 카메라를 보게 한다.
 * 반환 {pos: Float32Array(xyz), uv: Float32Array, index: Uint16Array}
 */
export function arcStrip(rc, H, span, N = 48, lean = 0) {
  const cl = Math.cos(lean), sl = Math.sin(lean);
  const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 2 * 2), index = new Uint16Array(N * 6);
  for (let i = 0; i <= N; i++) {
    const u = i / N, psi = -Math.PI / 2 - span / 2 + span * u; // 먼 쪽(−z) 원호, 왼쪽 → 오른쪽
    const c = Math.cos(psi), s = Math.sin(psi);
    for (let j = 0; j < 2; j++) {
      const r = rc + (j - 0.5) * H * cl, o = (i * 2 + j);
      pos[o * 3] = c * r; pos[o * 3 + 1] = j * H * sl; pos[o * 3 + 2] = s * r;
      uv[o * 2] = u; uv[o * 2 + 1] = j; // 바깥 = 글자 위(v = 1)
    }
  }
  for (let i = 0; i < N; i++) { const a = i * 2, q = i * 6; index[q] = a; index[q + 1] = a + 1; index[q + 2] = a + 2; index[q + 3] = a + 1; index[q + 4] = a + 3; index[q + 5] = a + 2; }
  return { pos, uv, index };
}
