// 자동 카메라의 순수 부분: 후보 판정·대상 고르기·대상 잃음 판정·대체 대상·프레임 점 맞추기.
// three·DOM 에 의존하지 않는다(좌표는 {x,y,z} 만 읽음) — node --test 로 시험한다.

export const WINDOW = 20;       // 점수 창(초)
export const STALE_DWELL = 3;   // 대상이 끝나거나 조용해졌을 때 이 시간(초)은 머문 뒤(비행 1.6초 포함) 일하는 노드로 넘어간다

export const ENDED = (st) => st === 'done' || st === 'stopped';

/**
 * 자동 카메라 깊이 — 따라가기·포커스(노드 클릭)·섬 투어를 더 가깝게. 3D(camera.js)·2D(flat/camera2d.js) 공용, 조정은 여기서만.
 * 수동 줌 한계(OrbitControls minDistance·2D D_MIN)는 그대로이고, 자동 카메라는 그보다 가까이 가지 않는다(`autoFloor`).
 * - NODE_KIDS: 노드 샷(넓은 구도 아님)에 함께 담는 보이는 자식 수 — 대상에 가까운 순(예전 24개, 순서대로). 활동 자손은 수와 무관하게 늘 담는다
 * - NODE_K: 노드 샷 거리 배율(3D 경계구 거리식에 곱함, 예전 1)
 * - NODE_MIN_R_K: 노드 샷 최소 반지름(minR·2D MIN_R)에 곱함(예전 1 — 노드가 몇 개 안 되면 이 바닥에 걸려 더 못 다가갔다)
 * - NODE_MARGIN_2D: 2D 노드 샷 맞춤 거리 여유(예전 1.1)
 * - CLUSTER_NODES: 섬 샷(섬 투어·선택 프로젝트 조망)을 섬 상자 대신 그 섬의 보이는 노드(복셀은 방 모서리 포함)로 맞춤(예전 상자 꼭짓점)
 */
export const ZOOM = { NODE_KIDS: 8, NODE_K: 0.85, NODE_MIN_R_K: 0.8, NODE_MARGIN_2D: 1.0, CLUSTER_NODES: true };

/** 자동 카메라 거리 바닥: 수동 줌 최소 거리보다 가까이 가지 않는다 */
export const autoFloor = (d, manualMin) => Math.max(d, manualMin || 0);

/** 노드 샷에 담을 자식: 대상 p 에 가까운 순으로 n 개(같으면 원래 순서) */
export function nearestKids(kids, posOf, p, n) {
  if (kids.length <= n) return kids.slice();
  const d2 = (k) => { const q = posOf(k); return q ? (q.x - p.x) ** 2 + ((q.y || 0) - (p.y || 0)) ** 2 + (q.z - p.z) ** 2 : Infinity; };
  return kids.map((k, i) => [k, d2(k), i]).sort((a, b) => (a[1] - b[1]) || (a[2] - b[2])).slice(0, n).map((x) => x[0]);
}

/** 화면에 보이는 노드인가: 퇴장(gone·exiting)·전체 보기 숨김·다른 프로젝트 희미(scopeK<0.5)·복셀 희미(dim)가 아님 */
export function isShown(v, dim = false) {
  if (!v || dim) return false;
  if (v.hidden || v.gone || (v.exiting != null)) return false;
  if (v.scopeK != null && v.scopeK < 0.5) return false;
  if (v.projOut) return false; // 나가는(숨는) 프로젝트는 페이드가 끝나기 전에도 카메라 후보가 아님
  return true;
}

/** 지금 활동 중인가: 열린 도구가 있거나, 끝나지 않은 노드가 active 이거나 최근 WINDOW 초 안에 이벤트 */
export function isLive(v, lastEventAt, now) {
  const open = v.icons ? v.icons.size || 0 : 0;
  if (open > 0) return true;
  const st = v.node && v.node.status;
  if (ENDED(st)) return false; // 끝난 노드는 곧 퇴장하므로 후보에서 뺀다(마지막 이벤트가 최근이어도)
  if (st === 'active') return true;
  return lastEventAt != null && now - lastEventAt < WINDOW;
}

/** 점수 = 최근 WINDOW 초 이벤트 수 + 열린 도구 × 2 + (5초 안 새 노드면 5) */
export function scoreOf(times, open, addedAt, now) {
  let n = 0;
  if (times) for (let i = times.length - 1; i >= 0 && now - times[i] < WINDOW; i--) n++;
  const add = addedAt != null && now - addedAt < 5 ? 5 : 0;
  return n + (open || 0) * 2 + add;
}

/**
 * 후보 [id, score] 중 최고 점수. 직전 대상은 건너뛰되, 다음 후보 점수가 0 이면(=조용한 노드) 직전 대상을 유지한다
 * — 예전엔 활동 중인 노드가 하나뿐이면 8초마다 조용한 노드로 넘어가 활동 노드를 놓쳤다.
 */
export function pickBest(list, prevTarget) {
  if (!list || !list.length) return null;
  const s = list.slice().sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1));
  let pick = s[0][0];
  if (s.length > 1 && pick === prevTarget && (s[1][1] > 0 || s[0][1] <= 0)) pick = s[1][0];
  return pick;
}

/**
 * 지금 샷을 잃었나. view 는 {has, vis, clusterTarget?, isDim?} 모양.
 * 노드 샷: 사라짐(node-remove)·숨김·퇴장 중·희미. 클러스터 샷: 섬이 사라짐.
 */
export function shotLost(view, shot, dim) {
  if (!shot) return true;
  if (shot.type === 'node') {
    if (!view.has(shot.id)) return true;
    return !isShown(view.vis.get(shot.id), dim ? dim(shot.id) : false);
  }
  if (shot.type === 'cluster') return !(view.clusterTarget && view.clusterTarget(shot.pid));
  return false;
}

export const QUIET = 4;        // 이 시간(초) 동안 이벤트·열린 도구가 없으면 '조용함'

/** 지금 일하는 중인가: 열린 도구가 있거나 QUIET 초 안에 이벤트 */
export function isBusy(v, lastAt, now) {
  const open = v && v.icons ? v.icons.size || 0 : 0;
  return open > 0 || (lastAt != null && now - lastAt < QUIET);
}

/**
 * 대상이 끝났거나 조용해졌는데(STALE_DWELL 이상 머묾) 다른 노드가 지금 일하고 있으면 넘어간다.
 * 예전엔 8초 박자가 올 때까지 조용한 대상만 확대해 비추고, 일하는 노드는 화면 밖에 있었다.
 */
export function shotStale(v, lastAt, since, now, otherBusy) {
  if (!v || !otherBusy || now - since < STALE_DWELL) return false;
  if (isBusy(v, lastAt, now)) return false;
  return true;
}

/** 대상이 사라졌을 때 이어서 볼 조상: parentOf(id) 를 따라 올라가 처음 보이는 노드 */
export function shownAncestor(id, parentOf, isShownId, maxDepth = 64) {
  let p = parentOf(id);
  for (let i = 0; p && i < maxDepth; i++) {
    if (isShownId(p)) return p;
    p = parentOf(p);
  }
  return null;
}

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * 프레임 점 맞추기: pts = [{p:{x,y,z}, r, must?}] 중 must(대상·활동 노드)를 먼저, 나머지는 중심에 가까운 순으로
 * 반지름 rMax 를 넘지 않는 만큼만 넣는다. 첫 점(대상)은 늘 들어간다.
 * → 거리 상한(distMax)에 걸려 경계구가 화면을 넘칠 때, 대상이 화면 밖으로 밀려나던 것을 막는다.
 * 반환 {center:{x,y,z}, r, used}
 */
export function fitFrame(pts, rMax) {
  if (!pts.length) return null;
  const used = [pts[0]];
  const box = { lo: { ...pts[0].p }, hi: { ...pts[0].p } };
  const grow = (b, p) => ({ lo: { x: Math.min(b.lo.x, p.x), y: Math.min(b.lo.y, p.y), z: Math.min(b.lo.z, p.z) }, hi: { x: Math.max(b.hi.x, p.x), y: Math.max(b.hi.y, p.y), z: Math.max(b.hi.z, p.z) } });
  const mid = (b) => ({ x: (b.lo.x + b.hi.x) / 2, y: (b.lo.y + b.hi.y) / 2, z: (b.lo.z + b.hi.z) / 2 });
  const radius = (set, c) => { let r = 0; for (const q of set) r = Math.max(r, d3(q.p, c) + q.r); return r; };
  // 빠른 길: 전부 들어가면 예전 계산(전체 상자 중심·경계구)과 같다
  let all = box;
  for (let i = 1; i < pts.length; i++) all = grow(all, pts[i].p);
  const ca = mid(all), ra = radius(pts, ca);
  if (ra <= rMax) return { center: ca, r: ra, used: pts.length };
  let cur = box;
  const tryAdd = (q) => {
    const nb = grow(cur, q.p);
    const c = mid(nb);
    const r = radius(used.concat([q]), c);
    if (r <= rMax) { used.push(q); cur = nb; return true; }
    return false;
  };
  const rest = pts.slice(1);
  const must = rest.filter((q) => q.must);
  const fill = rest.filter((q) => !q.must);
  const anchor = pts[0].p;
  must.sort((a, b) => d3(a.p, anchor) - d3(b.p, anchor));
  for (const q of must) tryAdd(q);
  const c0 = mid(cur);
  fill.sort((a, b) => d3(a.p, c0) - d3(b.p, c0));
  for (const q of fill) tryAdd(q);
  const center = mid(cur);
  return { center, r: radius(used, center), used: used.length };
}

/**
 * 비행 중 자세: 시선점은 직선 보간, 카메라는 시선점 기준 방향(정규화 보간)·거리(로그 보간)로 옮긴다.
 * 섬 사이처럼 멀리 옮길 때는 가운데에서 살짝 물러나(호) 양쪽이 잠깐이라도 같이 보이게 한다.
 * 예전엔 카메라 위치를 직선 보간해 중간에 시선점에 너무 붙거나 엉뚱한 곳을 보는 프레임이 있었다.
 * 반환 {tgt:{x,y,z}, pos:{x,y,z}} — e=0 이면 출발 자세, e=1 이면 도착 자세와 같다.
 */
export function flightPose(fromTgt, fromPos, toCenter, toDir, toDist, e) {
  const L = (a, b) => a + (b - a) * e;
  const tgt = { x: L(fromTgt.x, toCenter.x), y: L(fromTgt.y, toCenter.y), z: L(fromTgt.z, toCenter.z) };
  let ox = fromPos.x - fromTgt.x, oy = fromPos.y - fromTgt.y, oz = fromPos.z - fromTgt.z;
  const d0 = Math.hypot(ox, oy, oz) || 1e-6;
  ox /= d0; oy /= d0; oz /= d0;
  let dx = L(ox, toDir.x), dy = L(oy, toDir.y), dz = L(oz, toDir.z);
  const dl = Math.hypot(dx, dy, dz);
  if (dl < 1e-6) { dx = toDir.x; dy = toDir.y; dz = toDir.z; } else { dx /= dl; dy /= dl; dz /= dl; }
  const d1 = Math.max(1e-6, toDist);
  const travel = d3(fromTgt, toCenter);
  const hop = Math.min(1.5, travel / (2 * Math.max(d0, d1)));
  const dist = Math.exp(L(Math.log(d0), Math.log(d1))) * (1 + hop * Math.sin(Math.PI * e));
  return { tgt, pos: { x: tgt.x + dx * dist, y: tgt.y + dy * dist, z: tgt.z + dz * dist } };
}

// ---------------- 전체 맞춤(기본 자동 카메라) ----------------

/** 점들의 축 정렬 상자 중심 */
export function boxCenter(pts) {
  if (!pts.length) return { x: 0, y: 0, z: 0 };
  let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
  for (const { p } of pts) {
    if (p.x < lx) lx = p.x; if (p.y < ly) ly = p.y; if (p.z < lz) lz = p.z;
    if (p.x > hx) hx = p.x; if (p.y > hy) hy = p.y; if (p.z > hz) hz = p.z;
  }
  return { x: (lx + hx) / 2, y: (ly + hy) / 2, z: (lz + hz) / 2 };
}

/**
 * 시선점 c, 카메라 기저(R 오른쪽·U 위·F 앞, 단위벡터)에서 모든 점 {p, r} 이 화면 안(가로 tanH·세로 tanV, 여백 반영한 반화각 탄젠트)에
 * 들어오는 최소 카메라 거리. 카메라 = c − F·D, 점의 깊이 = D + (p−c)·F.
 */
export function requiredDist(pts, c, R, U, F, tanH, tanV) {
  let D = 0;
  for (const { p, r } of pts) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const x = dx * R.x + dy * R.y + dz * R.z;
    const y = dx * U.x + dy * U.y + dz * U.z;
    const z = dx * F.x + dy * F.y + dz * F.z;
    const need = Math.max((Math.abs(x) + r) / tanH - z, (Math.abs(y) + r) / tanV - z, r - z + 1);
    if (need > D) D = need;
  }
  return D;
}

/**
 * 투영 상자 맞춤: 원근에서는 3D 상자 중심이 화면 가운데가 아니라 한쪽이 남는다. 지금 중심·거리로 점들을 투영해
 * 화면 상자(반지름 포함)의 가운데가 화면 가운데에 오도록 시선점을 옮기고 거리를 다시 구하기를 iters 번.
 * 결과: 가로나 세로 중 한쪽이 여백(tanH·tanV) 끝까지 꽉 찬다. 반환 {c, D}
 */
export function refineFit(pts, c0, R, U, F, tanH, tanV, iters = 3) {
  let c = { x: c0.x, y: c0.y, z: c0.z };
  let D = requiredDist(pts, c, R, U, F, tanH, tanV);
  for (let it = 0; it < iters && pts.length; it++) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const { p, r } of pts) {
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      const x = dx * R.x + dy * R.y + dz * R.z, y = dx * U.x + dy * U.y + dz * U.z, z = dx * F.x + dy * F.y + dz * F.z;
      const depth = Math.max(1e-3, D + z);
      x0 = Math.min(x0, (x - r) / depth); x1 = Math.max(x1, (x + r) / depth);
      y0 = Math.min(y0, (y - r) / depth); y1 = Math.max(y1, (y + r) / depth);
    }
    const mx = ((x0 + x1) / 2) * D, my = ((y0 + y1) / 2) * D; // 화면 가운데 어긋남(시선점 깊이 평면의 세계 거리)
    if (Math.abs(mx) < 1e-4 && Math.abs(my) < 1e-4) break;
    c = { x: c.x + R.x * mx + U.x * my, y: c.y + R.y * mx + U.y * my, z: c.z + R.z * mx + U.z * my };
    D = requiredDist(pts, c, R, U, F, tanH, tanV);
  }
  return { c, D };
}

/**
 * 맞춤 구도 유지(히스테리시스): 노드 추가·퇴장으로 경계가 조금 바뀌면 움직이지 않는다.
 * - 지금 구도(중심 c·거리 D)로 다 못 담으면(필요 거리 > D × grow) 바로 다시 맞춤(여유 headroom 을 두어 조금 더 멀리)
 * - 필요한 거리가 D × shrink 보다 작은 상태가 hold 초 이어지면 다가감
 * - 이상적인 중심이 D × shift 넘게 벗어난 상태가 hold 초 이어지면 중심만 옮김(거리도 다시 계산)
 * step() 은 바뀌었으면 true.
 */
export class FitHold {
  constructor({ grow = 1.0, shrink = 0.86, shift = 0.12, hold = 2.0, headroom = 1.03, maxFreeze = 6 } = {}) { // 꽉 차게(여유 3%, 14% 넘게 헐거우면 2초 뒤 다가감)
    Object.assign(this, { grow, shrink, shift, hold, headroom, maxFreeze });
    this.c = null; this.D = 0; this._since = null; this.changes = 0;
  }
  reset() { this.c = null; this.D = 0; this._since = null; this._settle = false; this._frozenAt = null; }
  /**
   * want = {c, D}(이상적인 중심·거리), reqHere = 지금 중심에서 필요한 거리, dmin·dmax = 거리 범위.
   * freeze(퇴장 연출 중): 넘칠 때(새 노드가 화면 밖)만 다시 맞추고, 줄이기·중심 옮기기는 미룬다. 연출이 끝난 첫 걸음에서
   * 한 번만 — 느슨하면 기다리지 않고 바로 — 다시 맞춘다(연출 도중 줌 출렁임 없음). 퇴장이 끊이지 않고 이어져 maxFreeze 초를
   * 넘기면 미루기를 그만두고 평소 규칙(hold)으로 — 바쁜 장면에서 카메라가 영영 줄지 않는 일이 없게
   */
  step(now, want, reqHere, dmin = 0, dmax = Infinity, { freeze = false } = {}) {
    const clamp = (d) => Math.max(dmin, Math.min(dmax, d));
    const commit = () => { this.c = { ...want.c }; this.D = clamp(want.D * this.headroom); this._since = null; this._settle = false; this.changes++; return true; };
    if (!this.c) return commit();
    if (reqHere > this.D * this.grow + 1e-9 && this.D < dmax - 1e-9) return commit();
    if (freeze) {
      if (this._frozenAt == null) this._frozenAt = now;
      if (now - this._frozenAt < this.maxFreeze) { this._settle = true; this._since = null; return false; }
      this._settle = false; // 너무 길게 이어짐: 평소 규칙
    } else this._frozenAt = null;
    const off = Math.hypot(want.c.x - this.c.x, want.c.y - this.c.y, want.c.z - this.c.z);
    const loose = clamp(want.D * this.headroom) < this.D * this.shrink || off > this.D * this.shift;
    const settle = this._settle; this._settle = false;
    if (!loose) { this._since = null; return false; }
    if (settle) return commit();
    if (this._since == null) this._since = now;
    if (now - this._since >= this.hold) return commit();
    return false;
  }
}

// ---------------- 화면 아래 덮개를 뺀 맞춤 띠 ----------------
/**
 * 무대 높이 H 중 위 top·아래 bottom px 가 덮였을 때(이벤트 띠·매크로 타임라인·재생 막대·라벨 자리) 보이는 띠.
 * k = 띠 높이 / H(세로 반화각에 곱함), yc = 띠 가운데의 화면 세로 위치(NDC, 위 +). 너무 덮이면 띠를 화면 40% 로 묶는다.
 */
export function safeBand(H, top = 0, bottom = 0) {
  H = Math.max(1, H || 1);
  let t = Math.max(0, top || 0), b = Math.max(0, bottom || 0);
  const room = H * 0.6;
  if (t + b > room) { const s = room / (t + b); t *= s; b *= s; }
  return { k: (H - t - b) / H, yc: (b - t) / H };
}

/**
 * 무대 상자 st 와 덮개 상자들(DOMRect 비슷한 {top, bottom, left, right})로 무대 위·아래가 덮인 px.
 * 무대 아래쪽 절반에 걸친 덮개는 아래, 위쪽 절반은 위로 센다. 가로로 무대와 겹치지 않으면 무시.
 */
export function overlayInsets(st, rects) {
  let top = 0, bottom = 0;
  const mid = (st.top + st.bottom) / 2;
  for (const r of rects) {
    if (!r || r.bottom - r.top <= 0 || r.right <= st.left || r.left >= st.right) continue;
    if (r.bottom <= st.top || r.top >= st.bottom) continue;
    if (r.top >= mid || r.bottom >= st.bottom - 1) bottom = Math.max(bottom, st.bottom - r.top);
    else if (r.bottom <= mid) top = Math.max(top, r.bottom - st.top);
  }
  return { top, bottom };
}
