// 같은 프로젝트의 여러 live 세션 — 순수 규칙. three·DOM 없음(서버·웹·시험 공용).
//
// · live 메인: 그 프로젝트 liveList 의 CLI 세션(sdk-cli·claude -p 자식 제외). /clear 하면 같은 pid 의 sessionId 가 새 세션으로
//   바뀌므로(서버) liveList 가 곧 '지금 메인' 목록이다. 순서 = busy 먼저 → 최근 활동 → sessionId.
// · 세션 색: live 메인마다 고유 색. 세션 id 해시로 팔레트 칸을 고르고, 같은 칸이 겹치면 다음 칸(정렬된 sid 순서로 결정적).
//   팔레트는 테마 토큰(--sess-0…7)과 같은 값 — 다크·라이트 배경 대비를 따로 맞췄다. 주황(충돌 표시 --conflict)은 쓰지 않는다.

export const SESS_N = 8;
export const SESS_PALETTE = {
  dark: ['#5eb3ff', '#c38bff', '#4fd6a8', '#ff7ab6', '#e6d35a', '#8fa2ff', '#5fd3e6', '#b6e05a'],
  light: ['#1f6fc2', '#7d3fcf', '#0f8467', '#c2347a', '#857400', '#3f55c9', '#0d7f91', '#5b8510'],
};
export const CONFLICT_COLOR = { dark: '#ff9a3c', light: '#d0660a' };

/** FNV-1a 32비트 */
export function hash32(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

/** 프로젝트 항목의 live 메인 sessionId 들(순서: busy → 최근 활동 → sid) */
export function liveMainSids(rawProject) {
  const live = ((rawProject && rawProject.liveList) || []).filter((s) => s && s.sessionId && s.entrypoint !== 'sdk-cli' && !s.isChild);
  live.sort((a, b) => ((b.liveStatus === 'busy') - (a.liveStatus === 'busy')) || (tsOf(b.activityAt) - tsOf(a.activityAt)) || (a.sessionId < b.sessionId ? -1 : 1));
  return live.map((s) => s.sessionId);
}

/**
 * 세션 색 칸 배정. projects = 항목들. 돌려주는 값: Map<sessionId, 칸 번호 0…SESS_N-1>.
 * 같은 프로젝트 live 메인이 min 개 미만인 프로젝트는 넣지 않는다(색 없음).
 * 겹침은 전역에서 피한다(live 메인이 SESS_N 개 이하면 모두 다른 색). 같은 입력 → 같은 결과.
 */
export function sessionColorMap(projects, { min = 2 } = {}) {
  const sids = [];
  // 같은 프로젝트에 live 메인이 min 개(기본 2) 이상일 때만 색을 준다 — 세션 하나뿐인 화면은 예전 모습 그대로
  for (const p of projects || []) { const l = liveMainSids(p); if (l.length >= min) for (const sid of l) if (!sids.includes(sid)) sids.push(sid); }
  sids.sort();
  const out = new Map();
  const used = new Set();
  for (const sid of sids) {
    let k = hash32(sid) % SESS_N;
    for (let i = 0; i < SESS_N && used.has(k); i++) k = (k + 1) % SESS_N;
    used.add(k);
    if (used.size >= SESS_N) used.clear(); // 여덟을 넘으면 다시 처음부터(그때만 색이 겹침)
    out.set(sid, k);
  }
  return out;
}

/** 칸 번호 → 색(hex). light = 라이트 테마 */
export function sessHex(idx, light = false) {
  if (!Number.isInteger(idx) || idx < 0) return null;
  return (light ? SESS_PALETTE.light : SESS_PALETTE.dark)[idx % SESS_N];
}

/** 노드(rootSessionId·sessionId) → 그 세션 색 칸(없으면 null). colors = sessionColorMap 결과 */
export function nodeSessIdx(n, colors) {
  if (!n || !colors || !colors.size) return null;
  const sid = n.rootSessionId || (n.kind === 'main' && !n.parentId ? n.sessionId || String(n.id || '').replace(/^s:/, '') : null);
  if (!sid || !colors.has(sid)) return null;
  return colors.get(sid);
}

/**
 * 섬 안 다른 루트(지난 메인·독립 기동기·외부 작업)를 어느 live 메인 무리에 붙일지.
 * - 독립 기동기: 띄운 메인(spawner)이 live 면 그 메인, 아니면 그 메인이 붙은 곳
 * - 외부 작업(독립 claude -p): 추정 소속(likelyMain)이 live 면 그 메인
 * - 지난 메인: /clear 앞 세션일 가능성이 큰 쪽 — 그 메인이 끝난 시각(1분 여유) 뒤에 시작한 live 메인 중 시작이 끝에 가장 가까운 것,
 *   없으면 시작 시각이 가장 가까운 live 메인
 * @param others  [{nodeId, startMs, endMs, spawner?, likely?}]
 * @param anchors [{nodeId, startMs}]  (live 메인, 순서대로)
 * @returns Map<nodeId, anchorNodeId>
 */
export function assignToAnchors(others, anchors) {
  const out = new Map();
  if (!anchors.length) return out;
  const isA = new Set(anchors.map((a) => a.nodeId));
  const pending = [];
  for (const o of others) {
    if (o.spawner && isA.has(o.spawner)) out.set(o.nodeId, o.spawner);
    else if (o.likely && isA.has(o.likely)) out.set(o.nodeId, o.likely);
    else if (o.spawner) pending.push(o);
    else {
      const e = o.endMs || 0;
      const after = anchors.filter((a) => a.startMs >= e - 60_000).sort((a, b) => Math.abs(a.startMs - e) - Math.abs(b.startMs - e) || (a.nodeId < b.nodeId ? -1 : 1));
      if (after.length) out.set(o.nodeId, after[0].nodeId);
      else {
        const near = anchors.slice().sort((a, b) => Math.abs(a.startMs - (o.endMs || 0)) - Math.abs(b.startMs - (o.endMs || 0)) || (a.nodeId < b.nodeId ? -1 : 1));
        out.set(o.nodeId, near[0].nodeId);
      }
    }
  }
  // 띄운 메인이 지난 메인이면 그 메인이 붙은 곳으로(없으면 첫 메인)
  for (const o of pending) out.set(o.nodeId, out.get(o.spawner) || anchors[0].nodeId);
  return out;
}

/**
 * live 메인 수에 따른 섬 안 배치 모양(Flow).
 *  1 → 'center', 2～3 → 'facing'(2 = 좌우, 3 = 삼각), 4 이상 → 'pie'(파이 구역)
 *  각 메인의 바깥 방향 각(x-z 평면, 0 = +x, π/2 = +z 화면 아래쪽)과 무리 부채꼴 폭
 */
export function podAngles(n) {
  if (n <= 1) return { mode: 'center', dirs: [0], span: 2 * Math.PI };
  if (n === 2) return { mode: 'facing', dirs: [Math.PI, 0], span: Math.PI * 0.9 };
  if (n === 3) return { mode: 'facing', dirs: [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6], span: Math.PI * 0.62 };
  const dirs = [];
  for (let i = 0; i < n; i++) dirs.push(-Math.PI / 2 + (2 * Math.PI * i) / n);
  return { mode: 'pie', dirs, span: ((2 * Math.PI) / n) * 0.78 };
}
