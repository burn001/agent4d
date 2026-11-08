// 공유 링크 기본 리플레이 — 서버가 index.html 에 넣은 data-share-replay 를 읽고, 반복 구간 판정을 한다(순수 함수).
//   data-share-replay="<세션 UUID>|<시작 ms>|<끝 ms 또는 빈칸>|<배속>|<1=반복>" (server/share.mjs markShareHtml)

const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 속성 값 → {session, from, until, speed, loop} | null */
export function parseShareReplay(attr) {
  if (typeof attr !== 'string' || !attr) return null;
  const [session, f, u, sp, lp] = attr.split('|');
  if (!SID_RE.test(session || '')) return null;
  const from = Number(f);
  if (!Number.isFinite(from) || from <= 0) return null;
  const until = u === '' || u == null ? null : Number(u);
  if (until != null && !(Number.isFinite(until) && until > from)) return null;
  const speed = Number(sp);
  return { session: session.toLowerCase(), from, until, speed: Number.isFinite(speed) && speed > 0 ? speed : 1, loop: lp === '1' };
}

/**
 * 첫 화면을 기본 리플레이로 열까: 공유 표지가 있고, 주소에 ?live 가 없고, ?replay 가 없거나 같은 세션일 때(새로고침 — setReplayUrl 이 ?replay=<세션> 을 남김)
 * @returns {object|null} 열 기본 리플레이
 */
export function pickShareReplay(sr, params) {
  if (!sr || !params) return null;
  if (params.has('live')) return null;
  const rp = params.get('replay');
  if (rp && rp.toLowerCase() !== sr.session) return null;
  return sr;
}

/**
 * 반복 판정: 재생 시각이 끝 시각을 막 넘었거나(앞에서 넘어옴 — 끝 뒤로 직접 옮긴 경우는 건드리지 않음) 세션이 끝났으면 'restart'
 * @param {{from:number, until:number|null}} loop
 */
export function loopStep(loop, prevVt, vt, status) {
  if (!loop) return null;
  if (status === 'ended') return 'restart';
  if (loop.until == null || !Number.isFinite(vt)) return null;
  if (Number.isFinite(prevVt) && prevVt < loop.until && vt >= loop.until) return 'restart';
  return null;
}
