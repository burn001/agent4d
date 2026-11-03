// 끝난 별관 팀장(claude -p 세션) 퇴장. three·DOM 없음(node --test: web/test/lead-exit.test.mjs).
//   복셀 오피스(3D office.js·2D flat/voxel2d.js)와 복셀 연구소(LabView·Lab2DView — 같은 바탕 뷰)가 같이 쓴다.
//   예전엔 claude -p 팀장은 '퇴장하지 않음'(표)이라, 끝나 정리된 claude -p(백그라운드 시험 세션 등)가 스냅샷마다
//   별관 사무실·연구소 구역을 받은 채 흐린 팀장으로 영구히 남았다(흐름·Planet 은 exitEligible 로 이미 퇴장).
//   이제: 끝난 claude -p 팀장은 하위가 모두 퇴장 대상(exitEligible)이고 끝난 지 GRACE_MS 가 지나면 문으로 걸어 나가고,
//   다 나가면 자리 반납을 미루지 않아(HOLD 없음) 별관 방·연구소 구역도 함께 걷힌다. 스냅샷으로 들어온 오래전 끝난 팀장은
//   걷기 없이 바로 빠진다. 살아 있는(active·idle) claude -p·메인·루트는 건드리지 않는다. 다시 살아나면(updateNode) 새로 들어온다.
import { exitEligible, endedBadly } from '../flow-core.mjs';
import { isCycle } from '../batch-core.mjs';

export const LEAD_EXIT = {
  GRACE_MS: 8000,   // 끝난 뒤 이만큼(가상 시계)은 별관을 그대로 둔다 — 끝 순간(조명 낮춤·고개 숙임)을 볼 틈
  OLD_MS: 30000,    // 스냅샷으로 들어온 팀장이 이보다 오래전에 끝났으면 걷기 없이 바로 빠짐(RECENT_MS 와 같은 값)
  EVERY_S: 0.25,    // 판정 주기(벽시계 초)
};
const ENDED = new Set(['done', 'stopped', 'error']);
const endMs = (n) => Date.parse((n && (n.endedAt || n.lastActivityAt)) || '');

/**
 * 퇴장할 끝난 claude -p 팀장 id 집합. nodes: Map id → node, rootIds: 뷰 루트들(루트는 퇴장하지 않음), nowMs: 가상 시계.
 * 회차(isCycle)·메인은 대상 아님(회차는 원래 직원으로 퇴장). seen: 문제 있는 끝 첫 관찰 시각(vxHeldEnded 와 같은 장부).
 */
export function endedLeadsDue(nodes, rootIds = [], nowMs = null, { seen = null, graceMs = LEAD_EXIT.GRACE_MS } = {}) {
  const out = new Set();
  if (!nodes || !Number.isFinite(nowMs)) return out;
  if (seen) for (const [id, n] of nodes) { if (!endedBadly(n)) seen.delete(id); else if (!seen.has(id)) seen.set(id, nowMs); }
  let elig = null;
  for (const n of nodes.values()) {
    if (!n || n.kind !== 'claude-p' || !ENDED.has(n.status) || isCycle(n, nodes)) continue;
    const t = endMs(n);
    if (Number.isFinite(t) && nowMs - t < graceMs) continue;
    if (!elig) elig = exitEligible(nodes, rootIds, { nowMs, seen });
    if (elig.has(n.id)) out.add(n.id);
  }
  return out;
}

/** 뷰 루트들(_heldPass 와 같은 목록) */
export function viewRoots(v) {
  const roots = [v.rootId, v.layoutRoot];
  for (const r of (v.scope && v.scope.roots) || []) roots.push(r.nodeId);
  return roots;
}

/**
 * 한 프레임(3D VoxelView·2D Voxel2DView 공통). v = { chars: Map, machines: Map, _removing?: Set, layoutDirty, _badSeen? },
 * now = 뷰 벽시계(초), nodes = Map id → node, clockMs = 가상 시계(ms), force = 주기 무시하고 다시 판정(layoutNow — 스냅샷 직후). 바뀐 것이 있으면 true.
 *   · 대상 팀장: 자리에 있으면 forceLeave(노드 제거와 같은 문 퇴장), 스냅샷 첫 배치 전이고 오래전 끝났으면 바로 gone.
 *   · 다 나간 대상 팀장: 하위 직원이 모두 사라졌으면 곧바로 released(별관·구역 함께 걷힘), 하위 끝난 기계도 반납 대기를 당긴다.
 *   · 대상에서 빠지면(되살아남·하위가 다시 일함) 걷던 퇴장을 거둔다(노드 제거로 나가는 중이면 그대로).
 */
export function stepLeadExit(v, now, nodes, clockMs, force = false) {
  const st = v._leadExit || (v._leadExit = { at: -1, due: new Set() });
  if (force || st.at < 0 || now < st.at || now - st.at >= LEAD_EXIT.EVERY_S) {
    st.at = now;
    st.due = endedLeadsDue(nodes, viewRoots(v), clockMs, { seen: v._badSeen || (v._badSeen = new Map()) });
  }
  let changed = false;
  for (const ch of v.chars.values()) {
    if (!ch.lead || ch.kind !== 'claude-p') continue;
    const due = st.due.has(ch.id);
    if (due && !ch.leadExit) {
      ch.leadExit = true;
      const t = endMs(ch.node);
      const old = !ch.placed && ch.spawnMode === 'place' && !(Number.isFinite(t) && clockMs - t < LEAD_EXIT.OLD_MS);
      if (old || ch.state === 'gone') { ch.state = 'gone'; ch.goneAt = now; }
      else ch.forceLeave = true;
      changed = true;
    } else if (!due && ch.leadExit && ch.state !== 'gone') {
      ch.leadExit = false;
      if (!(v._removing && v._removing.has(ch.id))) ch.forceLeave = false;
      changed = true;
    }
    if (ch.leadExit && ch.state === 'gone' && !ch.released && subtreeGone(v, ch.id, nodes, now)) {
      ch.released = true; v.layoutDirty = true; changed = true;
    }
  }
  return changed;
}

/** 하위 직원이 모두 나갔는가(나가는 중이면 아직) — 그렇다면 하위 끝난 기계의 반납 대기를 지금으로 당긴다 */
function subtreeGone(v, leadId, nodes, now) {
  const kids = new Map();
  for (const n of nodes.values()) if (n && n.parentId) { if (!kids.has(n.parentId)) kids.set(n.parentId, []); kids.get(n.parentId).push(n.id); }
  const desc = [];
  const stack = [...(kids.get(leadId) || [])], seen = new Set();
  while (stack.length && seen.size < 4096) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id); desc.push(id);
    for (const c of kids.get(id) || []) stack.push(c);
  }
  for (const id of desc) { const c = v.chars.get(id); if (c && c.state !== 'gone' && !c.released && c.placed) return false; }
  for (const id of desc) {
    const c = v.chars.get(id);
    if (c && !c.released) { c.state = 'gone'; c.released = true; }
    const m = v.machines.get(id);
    if (m && !m.released && m.endWall != null && m.heldUntil > now) m.heldUntil = now;
  }
  return true;
}
