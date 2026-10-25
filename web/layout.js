// 배치 — 순수 함수. three 에 의존하지 않는다.

import { t } from './i18n.mjs';

export const RADIUS = {
  main: 3.0, subagent: 1.6, workflow: 2.2, 'workflow-agent': 1.3, 'claude-p': 1.7, 'bash-bg': 0.8, monitor: 0.8,
};
export const KINDS = Object.keys(RADIUS);
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k, t('app.kind.' + k)]));
export const KIND_SHAPE = Object.fromEntries(KINDS.map((k) => [k, t('app.shape.' + k)]));

const GOLDEN = 137.5 * Math.PI / 180;
const R1 = 14;
// 루트 바로 옆 기동기 거리: 루트·장치 경계 + 위성 고리(5) 바깥 여유 — 첫 고리(R1)보다 가깝게
const launchR = (root) => Math.max(10, nodeExtent(root) + DEVICE_EXTENT + 6);
const FAN = 70 * Math.PI / 180;
// 위성(부모 둘레 작은 원): 백그라운드 명령·모니터. 단 기동기(배치 장치)는 자기 하위(회차 → 서브에이전트)를 거느리므로
// 위성이 아니라 보통 자식처럼 바깥쪽으로 놓는다 — 위성으로 두면 부모 안쪽(조부모 쪽)으로 꺾여, 회차 사슬이 메인 위에 겹쳤다
const isLauncherNode = (n) => !!(n && n.meta && n.meta.launcher);
/** 부모가 끊긴 기동기(서버가 parentId null·meta.detached·spawnedBy 로 줌) — 루트 옆 독립 무리 */
export const isDetachedRoot = (n) => isLauncherNode(n) && !n.parentId && !!(n.meta && (n.meta.spawnedBy || n.meta.detached));
const DETACHED_GAP = 6;
// 러너(재기동기 → 러너 → 회차)도 회차를 거느리므로 위성이 아니라 보통 자식(장치 바깥으로 사슬)
const isRunnerNode = (n) => !!(n && n.meta && n.meta.runner);
const isSatellite = (n) => (n.kind === 'bash-bg' || n.kind === 'monitor') && !isLauncherNode(n) && !isRunnerNode(n);

/** 노드가 평면에서 차지하는 반지름(배치 단위, Flow 칩 기준 상한). 배치 장치는 넓은 상자 + 옆에 붙는 끝난 회차 자리 */
export const DEVICE_EXTENT = 2.6;
export function nodeExtent(n) {
  if (isLauncherNode(n)) return DEVICE_EXTENT;
  return RADIUS[n && n.kind] || RADIUS.subagent;
}
const CHILD_GAP = 4;    // 부모·자식 경계 사이 최소 틈(라벨이 칩 아래에 붙을 자리)
const SAT_BACK = 1.05;  // 위성 원호: 바로 안쪽(부모 쪽, 180°)을 비우고 ±(180°−60°) 뒤쪽 반원에 나눈다

/**
 * @param {Map<string, {id,parentId,kind,_order?,meta?}>} nodes
 * @param {string|null} rootId
 * @param {{sector?:{dir:number, span:number}}} opts  sector: 루트의 직속 자식·위성을 dir 방향 span 폭 부채꼴 안에만
 *   (같은 섬에 live 메인이 여럿일 때 무리가 그 메인의 바깥쪽으로만 펼쳐지게). 없으면 예전처럼 한 바퀴(황금각)
 * @returns {{pos: Map<string,{x,y,z}>, parentOf: Map<string,string|null>}}
 */
export function computeLayout(nodes, rootId, opts = {}) {
  const sector = opts && opts.sector && Number.isFinite(opts.sector.dir) ? opts.sector : null;
  const pos = new Map();
  const parentOf = new Map();
  if (!nodes.size) return { pos, parentOf };
  let root = rootId && nodes.has(rootId) ? rootId : null;
  if (!root) {
    for (const n of nodes.values()) if (!n.parentId || !nodes.has(n.parentId)) { root = n.id; break; }
    if (!root) root = nodes.keys().next().value;
  }
  // 부모 해석: 부모가 없거나 모르는 노드는 루트에 붙인다
  const kids = new Map();
  // 부모가 끊긴(분리 실행) 기동기: 서버가 parentId null 로 준다 → 관계(parentOf)는 null 그대로 두고(띄움 점선만),
  // 자리는 띄운 노드(meta.spawnedBy, 없으면 루트)의 자식처럼 첫 고리에 — "메인과 기동기가 너무 멀다"(예전: 트리 전체 왼쪽 바깥 무리)
  const detached = [];
  for (const n of nodes.values()) {
    if (n.id === root) { parentOf.set(n.id, null); continue; }
    if (isDetachedRoot(n)) {
      parentOf.set(n.id, null);
      const sp = n.meta && n.meta.spawnedBy;
      const host = sp && nodes.has(sp) && sp !== n.id ? sp : root;
      if (!kids.has(host)) kids.set(host, []);
      kids.get(host).push(n);
      continue;
    }
    const p = n.parentId && nodes.has(n.parentId) && n.parentId !== n.id ? n.parentId : root;
    parentOf.set(n.id, p);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  for (const arr of kids.values()) arr.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));

  const visited = new Set();
  const place = (id, p, depth, outX, outZ) => {
    if (visited.has(id) || depth > 40) return;
    visited.add(id);
    pos.set(id, p);
    const node = nodes.get(id);
    const ch = kids.get(id) || [];
    const sats = ch.filter((c) => isSatellite(c));
    let normal = ch.filter((c) => !isSatellite(c));

    // workflow: 자식(workflow-agent)을 고리 둘레에, phase 별 각도 구간
    if (node.kind === 'workflow' && normal.length) {
      const phases = [];
      const byPhase = new Map();
      for (const c of normal) {
        const ph = (c.meta && c.meta.phase) || '';
        if (!byPhase.has(ph)) { byPhase.set(ph, []); phases.push(ph); }
        byPhase.get(ph).push(c);
      }
      const n = normal.length;
      const rw = Math.max(4, (n * 3.1) / (2 * Math.PI));
      let a0 = Math.atan2(outZ, outX) - Math.PI / 2;
      for (const ph of phases) {
        const arr = byPhase.get(ph);
        const sector = (2 * Math.PI * arr.length) / n;
        arr.forEach((c, i) => {
          const a = a0 + sector * (i + 0.5) / arr.length;
          const cp = { x: p.x + Math.cos(a) * rw, y: p.y + (i % 2 ? -0.6 : 0.6), z: p.z + Math.sin(a) * rw };
          place(c.id, cp, depth + 1, cp.x - p.x, cp.z - p.z);
        });
        a0 += sector;
      }
      normal = [];
    }

    if (depth === 0 && sector) {
      // 부채꼴 고리: 고리마다 호 길이 3.6 당 한 자리, 차면 한 겹 바깥(5.5)
      const span = Math.max(0.3, Math.min(2 * Math.PI, sector.span));
      const slots = sectorSlots(normal.length, sector.dir, span);
      normal.forEach((c, i) => {
        const { a, r: r0 } = slots[i];
        const r = isLauncherNode(c) ? Math.min(r0, launchR(node)) : r0; // 메인이 부른 기동기는 바로 옆
        const cp = { x: p.x + Math.cos(a) * r, y: p.y + (i % 2 ? -1.5 : 1.5), z: p.z + Math.sin(a) * r };
        place(c.id, cp, 1, Math.cos(a), Math.sin(a));
      });
    } else if (depth === 0) {
      normal.forEach((c, i) => {
        const a = i * GOLDEN;
        const r0 = i < 16 ? R1 : R1 * Math.sqrt(i / 16); // 많아지면 해바라기 배치로 바깥으로
        const r = isLauncherNode(c) ? Math.min(r0, launchR(node)) : r0; // 메인이 부른 기동기는 바로 옆(회차 사슬은 바깥으로)
        const cp = { x: p.x + Math.cos(a) * r, y: p.y + (i % 2 ? -1.5 : 1.5), z: p.z + Math.sin(a) * r };
        place(c.id, cp, 1, Math.cos(a), Math.sin(a));
      });
    } else if (normal.length) {
      const d = depth + 1;
      const n = normal.length;
      let rd = Math.max(4, R1 * Math.pow(0.5, d - 1));
      if (n > 1) rd = Math.max(rd, (3.0 * (n - 1)) / (2 * FAN));
      // 크기 반영: 큰 노드(배치 장치 등)는 부모와 경계끼리 CHILD_GAP 이상 띄운다
      const pe = nodeExtent(node);
      for (const c of normal) rd = Math.max(rd, pe + nodeExtent(c) + CHILD_GAP);
      let base = Math.atan2(outZ, outX);
      if (!isFinite(base) || (outX === 0 && outZ === 0)) base = 0;
      normal.forEach((c, i) => {
        const off = n === 1 ? 0 : -FAN + (2 * FAN * i) / (n - 1);
        const a = base + off;
        const cp = { x: p.x + Math.cos(a) * rd, y: p.y + 2.4 + (i % 2 ? -0.8 : 0.8), z: p.z + Math.sin(a) * rd };
        place(c.id, cp, d, Math.cos(a), Math.sin(a));
      });
    }

    // bash-bg·monitor: 부모 아래(y −4) 작은 원. Flow·2D 는 높이를 없애므로 바로 안쪽(부모 쪽)은 비운다 —
    // 예전엔 첫 위성이 정확히 안쪽(rs 5 > 자식 거리 4)이라 평면에서 조부모 칩 위에 겹쳤다
    if (sats.length) {
      const n = sats.length;
      const rs0 = Math.max(5, nodeExtent(node) + 2.4);
      const back = Math.atan2(outZ, outX) + Math.PI; // 바깥 반대쪽(부모 쪽)
      const slots = [];
      if (depth === 0 && sector) {
        // 부채꼴 안 안쪽 고리(자식 고리 R1 보다 안)
        const span = Math.max(0.3, Math.min(2 * Math.PI, sector.span)) * 0.8;
        const rs = Math.max(rs0, (n * 2.4) / span);
        for (let i = 0; i < n; i++) slots.push({ a: sector.dir - span / 2 + (span * (i + 0.5)) / n, r: Math.min(rs, R1 - 4) });
      } else if (depth === 0) {
        const rs = Math.max(rs0, (n * 2.4) / (2 * Math.PI));
        for (let i = 0; i < n; i++) slots.push({ a: back + (2 * Math.PI * i) / Math.max(n, 3), r: rs });
      } else {
        // 뒤쪽 양옆(부모 쪽 ±SAT_BACK ～ 자식 부채꼴 직전)에 번갈아, 자리가 차면 한 겹 바깥 원으로
        const maxOff = Math.PI - FAN - 0.25;
        for (let ring = 0, i = 0; i < n; ring++) {
          const rs = rs0 + ring * 2.4;
          const step = 2.4 / rs;
          const per = Math.max(1, Math.floor((maxOff - SAT_BACK) / step) + 1);
          for (let j = 0; j < per * 2 && i < n; j++, i++) {
            const side = j % 2 ? -1 : 1;
            slots.push({ a: back + side * (SAT_BACK + Math.floor(j / 2) * step), r: rs });
          }
        }
      }
      sats.forEach((c, i) => {
        const { a, r: rs } = slots[i];
        const cp = { x: p.x + Math.cos(a) * rs, y: p.y - 4, z: p.z + Math.sin(a) * rs };
        place(c.id, cp, depth + 1, Math.cos(a), Math.sin(a));
      });
    }
  };
  // 독립 기동기가 루트(전체 보기의 기동기 무리)면 회차를 한 바퀴가 아니라 +x 부채꼴로(메인 오른쪽에 놓여 바깥으로 뻗음)
  if (isDetachedRoot(nodes.get(root))) place(root, { x: 0, y: 0, z: 0 }, 1, 1, 0);
  else place(root, { x: 0, y: 0, z: 0 }, 0, 1, 0);
  // 독립 기동기 무리: 루트 무리의 왼쪽(−x)에 나란히(무리 반지름 + DETACHED_GAP). 무리 안은 기동기를 깊이 0 루트처럼
  if (detached.length) {
    detached.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
    const extOf = (ids, cx) => { let e = 0; for (const id of ids) { const q = pos.get(id); const n = nodes.get(id); e = Math.max(e, Math.hypot(q.x - cx, q.z) + nodeExtent(n)); } return e; };
    let left = -extOf([...pos.keys()], 0);
    for (const d of detached) {
      const before = new Set(pos.keys());
      place(d.id, { x: 0, y: 0, z: 0 }, 1, -1, 0); // 깊이 1 처럼: 회차가 −x(메인 반대쪽) 부채꼴
      const ids = [...pos.keys()].filter((id) => !before.has(id));
      const e0 = Math.max(...ids.map((id) => pos.get(id).x + nodeExtent(nodes.get(id)))); // 무리 오른쪽 끝(기동기 쪽)
      const off = left - DETACHED_GAP - e0;
      for (const id of ids) { const q = pos.get(id); pos.set(id, { x: q.x + off, y: q.y, z: q.z }); }
      left = Math.min(...ids.map((id) => pos.get(id).x - nodeExtent(nodes.get(id))));
    }
  }
  // 순환 등으로 못 놓인 노드는 루트 근처 바깥쪽에
  let k = 0;
  for (const n of nodes.values()) {
    if (!pos.has(n.id)) {
      const a = k * GOLDEN; k++;
      pos.set(n.id, { x: Math.cos(a) * (R1 + 10), y: 3, z: Math.sin(a) * (R1 + 10) });
    }
  }
  return { pos, parentOf, root };
}

/** 부채꼴 고리 자리: n 개를 dir 중심 span 폭 안에, 고리(R1, R1+5.5, …)마다 호 길이 3.6 당 한 자리 */
export function sectorSlots(n, dir, span) {
  const out = [];
  for (let ring = 0, i = 0; i < n && ring < 64; ring++) {
    const r = R1 + ring * 5.5;
    const cap = Math.max(1, Math.floor((span * r) / 3.6));
    const k = Math.min(cap, n - i);
    for (let j = 0; j < k; j++, i++) out.push({ a: k === 1 ? dir : dir - span / 2 + (span * (j + 0.5)) / k, r });
  }
  return out;
}

/**
 * 장치에 붙은 끝난 회차 자리: 기동기 옆, 부모 → 기동기 방향에 수직으로(사슬 위의 부모·진행 회차와 겹치지 않게),
 * 장치 상자 바깥부터 slot 순서로 한 칸씩. lp = 기동기 자리, pp = 기동기 부모 자리(없으면 x 방향을 사슬로 본다)
 */
export function dockedPos(lp, pp, slot) {
  let dx = pp ? lp.x - pp.x : 1, dz = pp ? lp.z - pp.z : 0;
  const L = Math.hypot(dx, dz);
  if (L < 1e-6) { dx = 1; dz = 0; } else { dx /= L; dz /= L; }
  const d = DEVICE_EXTENT + 1.4 + slot * 1.6;
  return { x: lp.x - dz * d, y: lp.y, z: lp.z + dx * d };
}
