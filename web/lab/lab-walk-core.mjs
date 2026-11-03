// 【모듈 규격 · 캐릭터·동선(characters) 담당】 현장 걷기 계획(설계) — 순수(three·DOM 없음), node --test 대상. 3D·2D 공용.
//
// 길찾기는 이미 들어와 있음: Character._goTo → layout.js pathBetween → nav-core navPath(room) → roomObstacles(type 'lab') = room.navBoxes
// (computeLab 이 계산: 플랫폼 단·기자재·책상·브리지 난간(경사로만 열림)·외벽(출입문 틈)). 높이는 labFloorY(브리지 1.6·경사로 보간).
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ kind: WALK_RULES 키(field·alarm·install·watch·kill) — 이벤트 → kind 는 walkKindFor({act, danger, tool, cat, spawnBg})        │
// │ target: { room(type 'lab'), theta?(플랫폼 블록·구역 방위, field·alarm) | x,z(블록 자리 → 방위로), rig?(machine pos, type 'rig'), │
// │           from?:{x,z}(지금 자리 — 걷는 시간 추정), until?(watch wait: 작업 끝 시각) }                                        │
// │ now(초, 렌더러 프레임 시계) · ts(배속) · busy: 바깥(다른 장부)에서 이미 가장자리에 서 있는 인원                              │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 ─ export ──────────────────────────────────────────────────────────────────────────────────┐
// │ WALK_RULES  걷는 일 표: field(현장 투입)·alarm(위험 동작 확인)·install(기자재 설치)·watch(들여다보기)·kill(끄기)          │
// │ walkKindFor(ev) → kind | null       ev = {act(actOf 장면), danger(x), tool(도구 이름), cat(ix·도구 범주), spawnBg}    │
// │ class FieldPlanner  .want(kind, nodeId, target, now, ts, busy) → {spot:{x,z,face,field:kind}, until, kind, queue} | null      │
// │                     (null = 걷지 않음 → 책상에서 빛줄만) · .release(nodeId) · .clear() · .busyRim(now) · .active(nodeId, now)  │
// │ rimSpotFor(room, theta) → 가장 가까운 가장자리 접근점(방사 통로 경유는 nav 가 처리)                                          │
// │ rigFrontSpot(room, rigPos, i) → 기자재 앞 자리 i(0..RIG_FRONT−1, 그 뒤 RIG_QUEUE 칸은 대기 — 한 걸음 더 바깥)                │
// │ conflictSpots(room, theta) → [spotA, spotB] 같은 파일 충돌(설계): 그 블록 방위 가장자리 양옆 두 칸, 서로 마주 봄   │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 상한(LAB.WALK): 가장자리 동시 3명, 기자재 앞 2 + 대기 2. 걷지 않음: 배속 ≥ 8 · 직전 현장 방문 뒤 20초 안(field) · 자리 없음.
// 머무름은 배속이면 ÷√배속(VISIT_SEC 와 같은 규칙), 걷는 시간은 from 이 있으면 곧은 거리 × 1.4 ÷ 걷기 속도로 더한다.
// VoxelView 상태 머신과 잇는 갈고리(리드): want() 결과를 Character 의 visit 와 같은 '정한 시각까지 그 자리' 목표로 쓰되,
// 라운지 경유(door → loungePath) 없이 방 안 navPath 로 걷는다(room.type 'lab').
import { LAB, polar, dTheta, faceIn, faceOut, thetaOf } from './lab-const.mjs';

export const WALK_RULES = {
  field: { gapSec: 20, maxTs: 8, stay: 1.2, where: 'rim' },
  alarm: { stay: 2.6, maxTs: 8, where: 'rim' },
  install: { stay: 1.5, maxTs: 8, where: 'rig' },
  watch: { peek: 3, maxTs: 8, where: 'rig', waitMax: 60 },
  kill: { stay: 1.0, maxTs: 8, where: 'rig' },
};
/**
 * 연구소에서 시설(에어록 포털)로 걸어가지 않고 자기 책상에서 하는 도구 범주(11.02. 사용자 지적 "claude -p 가 혼자 동떨어진 곳에서 허우적댄다").
 * Agent·워크플로 도구는 하위가 끝날 때까지 열려 있다(claude -p 회차·서브에이전트의 전경 Agent 는 수 분～수십 분). 복셀 오피스는 포털이 자기 방
 * 안이라 괜찮지만 연구소 포털은 출입문 옆 외벽(플랫폼 건너편 30m 남짓)이라, 그동안 자기 책상·자기가 띄운 서브에이전트와 떨어져 포털 앞에서
 * 두 팔을 든 채(agent 포즈) 서 있었다. 연구소는 의뢰를 의뢰서 캡슐(띄운 쪽 책상 → 새 책상, lab-ix-core courierFor)로 보이므로
 * 띄운 쪽은 자기 책상에서 기다린다(책상 자세 = 홀로그램 조작). 새 서브에이전트는 그대로 에어록 포털로 들어온다(office _spawnPoint).
 */
export const LAB_DESK_CATS = new Set(['agent', 'workflow']);
/** 연구소에서 그 도구 범주로 시설에 걸어가나(false = 자기 책상에서) */
export function labWalksToStation(cat) { return !LAB_DESK_CATS.has(cat); }

/** 걷기 속도(m/s, character-core WALK_SPEED 와 같음) · 곧은 거리 → 길 길이 보정 */
const WALK_SPEED = 3.5, PATH_K = 1.4;

const KILL_TOOLS = /^(KillShell|KillBash|TaskStop)$/;
const WATCH_TOOLS = /^(TaskOutput|BashOutput)$/;
/** 이벤트 → 걷는 일(설계 표). 우선순위: 위험 > 끄기 > 들여다보기 > 기자재 설치 > 현장 투입(새로 만들기) */
export function walkKindFor(ev) {
  if (!ev) return null;
  if (ev.danger) return 'alarm';
  const tool = String(ev.tool || '');
  if (KILL_TOOLS.test(tool)) return 'kill';
  if (WATCH_TOOLS.test(tool) || ev.cat === 'monitor' || ev.watch) return 'watch';
  if (ev.spawnBg) return 'install';
  if (ev.act === 'build') return 'field';
  return null;
}

export function rimSpotFor(room, theta) {
  const s = room && room.lab && room.lab.rimSlots;
  if (!s || !s.length) return null;
  let best = s[0], bd = Infinity;
  for (const x of s) { const d = Math.abs(dTheta(theta, x.theta)); if (d < bd) { bd = d; best = x; } }
  return best;
}

export function rigFrontSpot(room, rigPos, i = 0) {
  const lab = room && room.lab;
  if (!lab || !rigPos) return null;
  const th = rigPos.theta != null ? rigPos.theta : thetaOf(lab.cx, lab.cz, rigPos.x, rigPos.z);
  const r = Math.hypot(rigPos.x - lab.cx, rigPos.z - lab.cz) + LAB.RIG.SIZE / 2 + 0.6 + 0.8 * Math.floor(i / 2);
  const p = polar(lab.cx, lab.cz, r, th + (i % 2 ? 1 : -1) * (0.35 / r) * (180 / Math.PI));
  return { x: p.x, z: p.z, face: faceIn(th) };
}

/** 같은 파일 충돌 방문 자리 두 개(블록 방위 θ 의 가장자리 칸 양옆, 서로를 봄) */
export function conflictSpots(room, theta) {
  const s = room && room.lab && room.lab.rimSlots;
  if (!s || !s.length) return [];
  const c = rimSpotFor(room, theta), n = s.length, a = s[(c.i - 1 + n) % n], b = s[(c.i + 1) % n];
  const yaw = (p, q) => Math.atan2(q.x - p.x, q.z - p.z);
  return [{ x: a.x, z: a.z, face: yaw(a, b), visit: true }, { x: b.x, z: b.z, face: yaw(b, a), visit: true }];
}

const thetaOfTarget = (room, t) => {
  if (t.theta != null && Number.isFinite(t.theta)) return t.theta;
  const lab = room.lab;
  if (Number.isFinite(t.x) && Number.isFinite(t.z)) return thetaOf(lab.cx, lab.cz, t.x, t.z);
  return null;
};
const rigKey = (rig) => (rig.slot != null ? 'rig:' + rig.slot : 'rig:' + rig.x.toFixed(2) + ',' + rig.z.toFixed(2));

export class FieldPlanner {
  constructor() {
    this.last = new Map(); // nodeId → 마지막 현장 투입(field) 시각
    this.res = new Map();  // nodeId → {kind, where, key, idx, until, spot}
  }
  /** 만료된 예약 지우기 */
  _gc(now) { for (const [id, r] of this.res) if (!(r.until > now)) this.res.delete(id); }
  /** 지금 가장자리에 서 있는(가는) 인원 */
  busyRim(now) { this._gc(now); let n = 0; for (const r of this.res.values()) if (r.where === 'rim') n++; return n; }
  /** 그 사람의 살아 있는 예약 */
  active(nodeId, now) { const r = this.res.get(nodeId); return r && r.until > now ? r : null; }

  want(kind, nodeId, target, now, ts = 1, busy = 0) {
    const rule = WALK_RULES[kind];
    const room = target && target.room;
    if (!rule || !room || !room.lab || nodeId == null || !Number.isFinite(now)) return null;
    if (!((ts || 1) < rule.maxTs)) return null;                  // 배속 ≥ 8: 순간 이동 규칙 — 걷지 않음
    this._gc(now);
    const mine = this.res.get(nodeId);
    if (kind === 'field') { const l = this.last.get(nodeId); if (l != null && now - l < rule.gapSec) return mine && mine.kind === kind ? this._out(mine) : null; }
    let spot = null, key = null, idx = -1, queue = false;
    if (rule.where === 'rim') {
      const th = thetaOfTarget(room, target);
      if (th == null) return null;
      const others = [...this.res.entries()].filter(([id, r]) => id !== nodeId && r.where === 'rim');
      if (Math.max(others.length, busy | 0) >= LAB.WALK.RIM_CONCURRENT) return null; // 가장자리 동시 3명
      const taken = new Set(others.map(([, r]) => r.idx));
      const slots = room.lab.rimSlots, n = slots.length, c = rimSpotFor(room, th).i;
      for (let d = 0; d <= 3 && idx < 0; d++) for (const i of d ? [(c + d) % n, (c - d + n) % n] : [c]) if (!taken.has(i)) { idx = i; break; }
      if (idx < 0) return null;
      const s = slots[idx];
      spot = { x: s.x, z: s.z, face: s.face, field: kind };
      key = 'rim';
    } else {
      const rig = target.rig;
      if (!rig || !Number.isFinite(rig.x) || !Number.isFinite(rig.z)) return null;
      key = rigKey(rig);
      const taken = new Set([...this.res.entries()].filter(([id, r]) => id !== nodeId && r.key === key).map(([, r]) => r.idx));
      const max = LAB.WALK.RIG_FRONT + LAB.WALK.RIG_QUEUE;
      for (let i = 0; i < max; i++) if (!taken.has(i)) { idx = i; break; }
      if (idx < 0) return null;                                  // 앞 2 + 대기 2 가 다 참
      queue = idx >= LAB.WALK.RIG_FRONT;
      const s = rigFrontSpot(room, rig, idx);
      spot = { x: s.x, z: s.z, face: s.face, field: kind, queue };
    }
    const sq = Math.max(1, Math.sqrt(ts || 1));
    let walk = 0;
    if (target.from && Number.isFinite(target.from.x)) walk = (Math.hypot(spot.x - target.from.x, spot.z - target.from.z) * PATH_K) / (WALK_SPEED * Math.min(6, Math.max(1, ts || 1)));
    let until = now + walk + (kind === 'watch' ? rule.peek : rule.stay) / sq;
    if (kind === 'watch' && Number.isFinite(target.until) && target.until > until) until = Math.min(target.until, now + walk + rule.waitMax);
    const r = { kind, where: rule.where, key, idx, until, spot, queue };
    this.res.set(nodeId, r);
    if (kind === 'field') this.last.set(nodeId, now);
    return this._out(r);
  }
  _out(r) { return { spot: r.spot, until: r.until, kind: r.kind, queue: !!r.queue }; }
  /** 예약만 돌려줌(현장 투입 간격 기록은 유지) */
  release(nodeId) { this.res.delete(nodeId); }
  /** 전부 비움(배치가 바뀜·재생 탐색) */
  clear() { this.res.clear(); this.last.clear(); }
}

export { faceOut };
