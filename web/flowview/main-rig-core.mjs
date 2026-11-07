// 흐름(Flow) 3D 메인 몸(반응로 코어 · 데이터 띠 기둥) — 순수 부분(three·DOM 없음). 그리기는 main-rigs.js,.
// 치수는 노드 반지름(s = 메시 배율) 단위, 몸 가운데 = 노드 자리(group.position). 홀로그램 패널·라벨·빔·카메라 맞춤이 이 값으로 자리를 잡는다.
import { NODE_STATE } from './flow-style.mjs';

export const MAIN_RIG = {
  BOTTOM: 0.6,   // 몸 밑면(가운데 아래) — 빔이 여기서 나가고 그림자 기둥줄이 여기까지
  TOP: 0.72,     // 몸 윗면(가운데 위) — 사용자 콘솔 빔이 여기로 들어옴
  HOLO_K: 1.18,  // 홀로그램 패널 거리 반지름 배수(자이로 고리·띠가 반지름 밖으로 조금 나감)
  // 반응로
  R: { plate: 1.0, plateH: 0.13, frame: 0.92, frameH: 1.0, core: 0.28, wire: 0.37, gyro: [0.55, 0.45], pillar: 0.03, fill: 0.042 },
  // 데이터 띠 기둥
  C: { plate: 0.95, plateH: 0.1, shell: 0.83, colH: 1.13, spine: 0.19, band: 0.86, bandH: 0.1, bandY: [0.18, 0.55, 0.92], capH: 0.09 },
  TEX_FPS: 12,   // 띠 글 텍스처 다시 그리기 상한(바뀔 때만)
  LOD_PX: 12,    // 화면 반지름이 이보다 작으면 세부(자이로·불티·띠 글 흐름) 멈춤
  // 깊이를 남기지 않는 부분(유리·가산 띠·선·자이로·빛무리, 가림 페이드로 깊이를 끈 몸)의 그리기 순서. 칩 깊이(0.9)·색(1)·콘솔(1.6)·네모 터미널 앞면 글(1.7) 다음,
  // 빔(2) 전 — 순서 0 이면 칩보다 먼저 칠해져 뒤에 있는 노드(특히 메인 옆 네모 터미널)가 그 위를 덮어 앞에 있는 것처럼 보였다(2026-11-04)
  LATE_RO: 1.8,
};

/** 메인 몸 부분의 renderOrder: 깊이를 쓰는 몸 = 0(칩보다 먼저 깊이를 남겨 뒤 노드를 가림), 깊이를 안 쓰는 부분 = LATE_RO(뒤 노드 위에 섞임) */
export function mainPartOrder(depthWrite) { return depthWrite ? 0 : MAIN_RIG.LATE_RO; }

/**
 * 상태 → 몸 연출 값(반응로·기둥 공용). st = NODE_STATE 번호, t = 초, reduced = 움직임 줄이기.
 * glow 코어/띠 밝기 · spin 자이로 각속도 · scroll 띠 흐름 속도 · think 도는 점 · sparks 불티 · dashed 완료 점선 띠 · pulse 오류 맥동
 */
export function mainLook(st, t, reduced = false) {
  const act = st === NODE_STATE.thinking || st === NODE_STATE.tool;
  const tool = st === NODE_STATE.tool, done = st === NODE_STATE.done, err = st === NODE_STATE.error, stop = st === NODE_STATE.stopped;
  const pulse = err && !reduced ? 0.55 + 0.45 * Math.sin(t * 6) : 1;
  return {
    act, tool, done, err, stop,
    think: st === NODE_STATE.thinking,
    glow: (done ? 0.4 : stop ? 0.3 : act ? 1 : 0.65) * pulse,
    spin: reduced || done || stop ? 0 : tool ? 3.2 : act ? 1.0 : 0.3,
    scroll: reduced || done || stop ? 0 : tool ? 0.12 : act ? 0.05 : 0.012,
    sparks: tool && !reduced,
    dashed: done,
    pulse,
  };
}

/** 빔 끝점 높이(노드 가운데 기준, s 단위): 메인에서 나가는 빔 = 밑면, 메인으로 들어오는 빔 = 윗면 */
export const mainLinkY = (asParent) => (asParent ? -MAIN_RIG.BOTTOM : MAIN_RIG.TOP);
