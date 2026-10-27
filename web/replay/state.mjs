// 재생 상태 reducer. DOM·three 에 의존하지 않는 순수 모듈 — node --test 로 시험한다.
// 규칙은 web/app.js 의 onSnapshot/onEvent 가 store 를 고치는 방식과 같다(서버 replay.mjs 의 keyframe 과도 같은 의미).

export function createState({ root = null, sessionId = null, seq = 0 } = {}) {
  return { nodes: new Map(), root, seq, sessionId };
}

export function copyNode(n) {
  return { ...n, meta: { ...(n.meta || {}) }, openTools: (n.openTools || []).map((t) => ({ ...t })) };
}

/** 스냅샷({root, sessionId, seq, nodes}) 으로 상태를 만든다 — app.onSnapshot 과 같은 의미 */
export function stateFromSnapshot(snap) {
  const st = createState({ root: snap.root || null, sessionId: snap.sessionId || null, seq: snap.seq || 0 });
  for (const n of snap.nodes || []) st.nodes.set(n.id, copyNode(n));
  return st;
}

/**
 * 이벤트 하나를 적용한다. app.js 와 같이 seq 가 숫자면 seq ≤ state.seq 인 이벤트는 버린다.
 * 반환: 적용했으면 true.
 */
export function applyEvent(state, ev) {
  if (!ev || !ev.type) return false;
  if (typeof ev.seq === 'number') {
    if (ev.seq <= state.seq) return false;
    state.seq = ev.seq;
  }
  const n = state.nodes.get(ev.nodeId); // app.js 와 같이 switch 전에 찾는다(새 node-add 는 lastActivityAt 을 node 값 그대로 둠)
  switch (ev.type) {
    case 'node-add': {
      const node = ev.node;
      if (!node) break;
      const prev = state.nodes.get(node.id);
      if (prev) Object.assign(prev, copyNode(node));
      else {
        const c = copyNode(node);
        state.nodes.set(c.id, c);
        if (!state.root && (c.kind === 'main' || !c.parentId)) state.root = c.id;
      }
      break;
    }
    case 'node-update': {
      if (!n) break;
      const { meta, ...rest } = ev.patch || {};
      Object.assign(n, rest);
      if (meta) n.meta = { ...(n.meta || {}), ...meta };
      break;
    }
    case 'tool-start':
      if (n) {
        n.openTools = n.openTools || [];
        if (!n.openTools.some((t) => t.toolUseId === ev.toolUseId)) {
          n.openTools.push({ toolUseId: ev.toolUseId, tool: ev.tool, cat: ev.cat, skill: ev.skill, startedAt: ev.ts, text: ev.text, ...(ev.brief ? { brief: ev.brief } : {}), ...(ev.panel ? { panel: ev.panel } : {}) });
        }
      }
      break;
    case 'tool-end':
      if (n) n.openTools = (n.openTools || []).filter((t) => t.toolUseId !== ev.toolUseId);
      break;
    case 'tool-summary': // 서버 몰림 정리: 짝이 맞은 도구 n건(시작·끝을 대신함) — 열려 있던 같은 id 는 닫음
      if (n && Array.isArray(ev.ids) && ev.ids.length) { const ids = new Set(ev.ids); n.openTools = (n.openTools || []).filter((t) => !ids.has(t.toolUseId)); }
      break;
    case 'node-remove': // 전체 보기 전용: 서브트리 제거
      for (const id of (Array.isArray(ev.ids) && ev.ids.length ? ev.ids : [ev.nodeId])) state.nodes.delete(id);
      return true;
    default:
      break;
  }
  if (n && ev.ts) n.lastActivityAt = ev.ts;
  return true;
}

export function cloneState(state) {
  const st = createState({ root: state.root, sessionId: state.sessionId, seq: state.seq });
  for (const [id, n] of state.nodes) st.nodes.set(id, copyNode(n));
  return st;
}

/** app.onSnapshot 에 넘길 모양. nodes 는 생성(삽입) 순서 그대로 */
export function toSnapshot(state, recent = []) {
  return {
    root: state.root,
    sessionId: state.sessionId,
    seq: state.seq,
    nodes: [...state.nodes.values()].map(copyNode),
    recent: recent.slice(-300),
  };
}

/** 시험·교차 확인용: 비교에 쓰는 필드만 뽑는다 */
export function summarize(state, fields = ['status', 'parentId', 'depth', 'label', 'endedAt', 'kind']) {
  const out = {};
  for (const [id, n] of state.nodes) {
    const o = {};
    for (const f of fields) o[f] = n[f] ?? null;
    o.openTools = (n.openTools || []).map((t) => t.toolUseId);
    out[id] = o;
  }
  return out;
}
