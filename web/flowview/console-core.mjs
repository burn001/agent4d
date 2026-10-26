// 흐름(Flow) 3D 입체 사용자 단말 — 순수 부분(three·DOM 없음). 그리기는 console3d.js.

/** 화면 폭(px)이 이보다 작으면 단순(뒷면 덮개·표시등 접음) */
export const CON_LOD_PX = 26;

/** 상태 → 화면 발광·표시등(색 열쇠·세기)·스캔라인 속도. con = geo.cons 항목(입체 모드), now = 초, reduced = 움직임 줄이기 */
export function consoleLook(con, now, reduced = false) {
  const st = con.state, dim = con.dim ?? 1, pulse = con.pulse || 0;
  let glow = 0.06, led = 'dim', ledK = 0.35, scan = 0;
  const blink = (hz, lo = 0.25) => (reduced ? 1 : lo + (1 - lo) * (Math.sin(now * Math.PI * 2 * hz) > 0 ? 1 : 0));
  if (st === 'working') { glow = 0.42; led = 'read'; ledK = reduced ? 0.9 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now * 2.2)); scan = 1.4; }
  else if (st === 'answered') { glow = 0.5 + pulse * 2.2; led = 'ok'; ledK = 0.9; scan = 0.5; }
  else if (st === 'asking' || con.asking) { glow = 0.72 + (reduced ? 0 : 0.2 * Math.sin(now * 5)); led = 'user'; ledK = blink(1.6); scan = 0.9; }
  else if (st === 'alert') { glow = 0.55; led = 'err'; ledK = blink(3); scan = 0.5; }
  else { scan = 0.3; } // idle: 아직 메시지 없음 — 옅은 화면, 꺼진 듯한 표시등
  if (con.fail > 0.05) { glow = Math.max(glow, 0.5 + con.fail * 0.4); led = 'err'; ledK = 1; }
  return { glow: Math.min(1, glow * dim), led, ledK, scan: reduced ? 0 : scan };
}

