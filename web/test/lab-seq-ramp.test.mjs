// node --test "web/test/lab-seq-ramp.test.mjs"   복셀 연구소 [T3-seq-card-ramp] 시퀀서(기동기) 앞 시료 카드 ↔ 브리지 경사로 겹침 판정(이슈 5).
// computeLab 으로 메인 + 기동기(시퀀서, k = 0..2) + 시퀀서마다 작업(meta.job) 1·4·8 개, 구역 1·2·3(다중 메인)에서
//   (a) 3D 판 발자국(카드 중심, 접선 폭 BOARD_W, 깊이 0.12, 방향 face) ↔ 모든 구역 bridgeRects 의 ramp·deck — 여유 0.1m 두고 교차 0
//   (b) 2D 칩 중심 jobFlatPos(pos) 마다 반경 0.12 원 ↔ ramp·deck 교차 0
//   (c) 이웃 시퀀서(k±1) 몸체 상자 ↔ 판·칩 교차 0 (자기 시퀀서 몸체와도 겹치지 않음)
//   (d) 외벽 안(반지름 < rWall − 0.3)  (e) 결정적(같은 입력 → 같은 자리, prev 를 줘도 같은 자리)
// 회전된 사각형 교차는 아래 SAT 도우미(분리축 정리)로 — 겹치면 음수(침투 깊이), 떨어져 있으면 최소 간격(양수).
// 일반 기자재·팀장·직원 카드 자리는 그대로인지도 본다(lab-marks (b)(c) 와 같은 기대값).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, DEG, worldToBridge } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { bridgeRects, quadXZ } from '../lab/lab2d-core.mjs';
import { JOBCARD, jobFlatPos, jobAnchor } from '../voxel/vx-job-core.mjs';
import { BATCH } from '../batch-core.mjs';

const T0 = Date.parse('2026-11-01T00:00:00Z');
const CHIP_R = 0.12, BOARD_D = 0.12, BOARD_PAD = 0.1, WALL_PAD = 0.3;
// 시퀀서 몸체 상자: nav-core BATCH.DEVICE_K 상자(복합기 1.66K × 1.24K)·연구소 시퀀서 원경 실루엣(1.76 × 1.24)·길찾기 정사각(1.6) 가운데 큰 값
const K = BATCH.DEVICE_K;
const SEQ_W = Math.max(1.66 * K, 1.76, 1.6), SEQ_D = Math.max(1.24 * K, 1.24, 1.6);

// ── SAT 도우미 ──
const quad = (x, z, w, d, thetaDeg) => { const q = quadXZ(x, z, w, d, thetaDeg); return [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]; };
function axesOf(P) { const a = []; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1; a.push([-ez / L, ex / L]); } return a; }
function proj(P, ax) { let lo = Infinity, hi = -Infinity; for (const p of P) { const t = p[0] * ax[0] + p[1] * ax[1]; if (t < lo) lo = t; if (t > hi) hi = t; } return [lo, hi]; }
function segDist(p, a, b) { const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1; let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ez); }
/** 볼록 다각형 둘: 겹치면 −(최소 침투), 아니면 최소 거리 */
function polyGap(A, B) {
  let pen = Infinity, sep = false;
  for (const ax of [...axesOf(A), ...axesOf(B)]) {
    const [a0, a1] = proj(A, ax), [b0, b1] = proj(B, ax), o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) { sep = true; break; }
    pen = Math.min(pen, o);
  }
  if (!sep) return -pen;
  let d = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let i = 0; i < Q.length; i++) d = Math.min(d, segDist(p, Q[i], Q[(i + 1) % Q.length]));
  return d;
}
/** 점 ↔ 볼록 다각형: 안이면 음수 */
function ptGap(p, P) {
  let inside = true;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) { inside = false; break; } }
  let d = Infinity;
  for (let i = 0; i < P.length; i++) d = Math.min(d, segDist(p, P[i], P[(i + 1) % P.length]));
  return inside ? -d : d;
}
// 사각형 꼭짓점 순서가 시계/반시계 어느 쪽이든 ptGap 이 맞게: 반시계로 맞춤
function ccw(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s > 0 ? P : P.slice().reverse(); }

test('SAT 도우미 자체 점검', () => {
  const A = quad(0, 0, 2, 2, 0), B = quad(3, 0, 2, 2, 0), C = quad(1.5, 0, 2, 2, 30);
  assert.ok(Math.abs(polyGap(A, B) - 1) < 1e-9);
  assert.ok(polyGap(A, C) < 0);
  assert.ok(ptGap([0, 0], ccw(A)) < 0 && Math.abs(ptGap([2, 0], ccw(A)) - 1) < 1e-9);
});

// ── 입력 ──
function jobsFor(owner, n) {
  return Array.from({ length: n }, (_, i) => ({ id: `j:${owner}:${i}`, kind: 'bash-bg', parentId: owner, status: 'active', order: 1000 + i,
    meta: { job: { v: 1, id: String(i), title: 'job ' + i, state: 'running', startedAt: new Date(T0 + i * 1000).toISOString(), beatAt: new Date(T0).toISOString() } } }));
}
function input(nMain, nSeq, nJob, { subs = 1 } = {}) {
  const out = [];
  for (let m = 0; m < nMain; m++) {
    const mid = 's:m' + m;
    out.push({ id: mid, kind: 'main', status: 'active', projectId: 'P', order: out.length, sessionId: 'm' + m, lastActivityAt: new Date(T0).toISOString() });
    for (let i = 0; i < subs; i++) out.push({ id: `m${m}_s${i}`, kind: 'subagent', parentId: mid, status: 'active', projectId: 'P', order: out.length });
    out.push({ id: `m${m}_bg`, kind: 'bash-bg', parentId: mid, status: 'active', projectId: 'P', order: out.length, meta: { command: 'npm test' } }); // 일반 기자재
    for (let k = 0; k < nSeq; k++) {
      const L = `m${m}_L${k}`;
      out.push({ id: L, kind: 'bash-bg', parentId: mid, status: 'active', projectId: 'P', order: out.length, meta: { launcher: { script: `r${k}.sh` } } });
      out.push(...jobsFor(L, nJob));
    }
  }
  return out;
}

/** 시퀀서 카드 하나의 간격(최소값 묶음) */
function measure(L) {
  const lab0 = L.rooms[0].lab, rW = lab0.R.rWall, cx = lab0.cx, cz = lab0.cz;
  const bridges = lab0.bridges;
  const obst = [];
  for (const f of bridges) for (const r of bridgeRects(f)) if (r.kind === 'ramp' || r.kind === 'deck') obst.push({ kind: r.kind, P: ccw(quad(r.x, r.z, r.w, r.d, r.theta)) });
  const seqs = [...L.machine.entries()].filter(([, m]) => m.type === 'batch');
  const body = (m) => ccw(quad(m.x, m.z, SEQ_W, SEQ_D, m.face / DEG));
  const g = { board: Infinity, chip: Infinity, nbBoard: Infinity, nbChip: Infinity, ownBoard: Infinity, ownChip: Infinity, wall: Infinity, n: 0 };
  for (const [, p] of L.machine) {
    if (p.type !== 'job') continue;
    const om = L.machine.get(p.owner);
    if (!om || om.type !== 'batch') continue;
    g.n++;
    const B = ccw(quad(p.x, p.z, JOBCARD.BOARD_W, BOARD_D, p.face / DEG));
    const q = jobFlatPos(p);
    for (const o of obst) {
      g.board = Math.min(g.board, polyGap(B, o.P));
      g.chip = Math.min(g.chip, ptGap([q.x, q.z], o.P) - CHIP_R);
    }
    for (const [, s] of seqs) {
      if (s.roomId !== om.roomId) continue;
      const P = body(s);
      if (s === om) { g.ownBoard = Math.min(g.ownBoard, polyGap(B, P)); g.ownChip = Math.min(g.ownChip, ptGap([q.x, q.z], P) - CHIP_R); }
      else if (Math.abs(s.slot - om.slot) === 1) { g.nbBoard = Math.min(g.nbBoard, polyGap(B, P)); g.nbChip = Math.min(g.nbChip, ptGap([q.x, q.z], P) - CHIP_R); }
    }
    let rMax = Math.hypot(q.x - cx, q.z - cz) + CHIP_R;
    for (const c of B) rMax = Math.max(rMax, Math.hypot(c[0] - cx, c[1] - cz));
    g.wall = Math.min(g.wall, rW - rMax);
  }
  return g;
}

const CASES = [];
for (const nMain of [1, 2, 3]) for (const nSeq of [1, 2, 3]) for (const nJob of [1, 4, 8]) CASES.push({ nMain, nSeq, nJob });

test('(a)～(e) 시퀀서 앞 시료 카드: 경사로·덱·이웃 시퀀서·외벽과 겹치지 않음 · 결정적', (t) => {
  const fails = [], chk = (ok, msg) => { if (!ok) fails.push(msg); };
  const worst = { board: Infinity, chip: Infinity, nbBoard: Infinity, nbChip: Infinity, ownBoard: Infinity, ownChip: Infinity, wall: Infinity };
  for (const rP of [LAB.PLATFORM.R_MIN, LAB.PLATFORM.R_DEFAULT, LAB.PLATFORM.R_MAX]) for (const subs of [1, 30]) for (const c of CASES) {
    const ns = input(c.nMain, c.nSeq, c.nJob, { subs });
    const L = computeLab(ns, 's:m0', null, { rP });
    assert.equal(L.rooms.length, c.nMain);
    const g = measure(L), tag = `rP ${rP} subs ${subs} 구역 ${c.nMain} 시퀀서 ${c.nSeq} 작업 ${c.nJob}`;
    assert.equal(g.n, c.nMain * c.nSeq * c.nJob, tag + ' 카드 수');
    for (const k of Object.keys(worst)) worst[k] = Math.min(worst[k], g[k]);
    chk(g.board >= BOARD_PAD - 1e-9, `${tag}: (a) 3D 판 ↔ 경사로·덱 간격 ${g.board.toFixed(3)} < ${BOARD_PAD}`);
    chk(g.chip >= 0, `${tag}: (b) 2D 칩 ↔ 경사로·덱 간격 ${g.chip.toFixed(3)} < 0`);
    chk(g.nbBoard >= 0 && g.nbChip >= 0, `${tag}: (c) 이웃 시퀀서 판 ${g.nbBoard.toFixed(3)} · 칩 ${g.nbChip.toFixed(3)}`);
    chk(g.ownBoard >= 0 && g.ownChip >= 0, `${tag}: (c) 자기 시퀀서 판 ${g.ownBoard.toFixed(3)} · 칩 ${g.ownChip.toFixed(3)}`);
    chk(g.wall >= WALL_PAD, `${tag}: (d) 외벽 여유 ${g.wall.toFixed(3)} < ${WALL_PAD}`);
    // (e) 결정적 · prev 를 줘도 같은 자리
    const jobsOf = (X) => [...X.machine.entries()].filter(([, m]) => m.type === 'job').sort((a, b) => (a[0] < b[0] ? -1 : 1));
    assert.deepEqual(jobsOf(computeLab(ns, 's:m0', null, { rP })), jobsOf(L), tag + ' (e) 같은 입력 → 같은 자리');
    assert.deepEqual(jobsOf(computeLab(ns, 's:m0', L, { rP })), jobsOf(L), tag + ' (e) prev 로 같은 자리');
  }
  t.diagnostic(`최소 간격(m): 3D 판↔경사로·덱 ${worst.board.toFixed(3)} · 2D 칩↔경사로·덱 ${worst.chip.toFixed(3)} · 이웃 시퀀서 판 ${worst.nbBoard.toFixed(3)}/칩 ${worst.nbChip.toFixed(3)} · 자기 시퀀서 판 ${worst.ownBoard.toFixed(3)}/칩 ${worst.ownChip.toFixed(3)} · 외벽 ${worst.wall.toFixed(3)}`);
  assert.deepEqual(fails.slice(0, 12), [], fails.length + " 건 실패");
});

test('시퀀서 카드: 판은 중심 쪽(브리지 yawIn) · 주인 시퀀서와 같은 구역·같은 방 · 칸·주인 그대로 · 작업이 늘어도 자리 고정', () => {
  const A = computeLab(input(2, 3, 1), 's:m0', null, {}), Bm = computeLab(input(2, 3, 8), 's:m0', A, {});
  for (const X of [A, Bm]) for (const [id, p] of X.machine) {
    if (p.type !== 'job') continue;
    const om = X.machine.get(p.owner);
    if (!om || om.type !== 'batch') continue;
    assert.equal(p.roomId, om.roomId); assert.equal(X.roomOf.get(id), om.roomId);
    assert.ok(Math.abs(p.face - om.face) < 1e-9, '판 = 중심 쪽(시퀀서 face)');
    assert.equal(p.ownerType, 'rig'); assert.equal(p.pole, 0);
    assert.ok(Math.abs(p.y - (0.95 + p.slot * JOBCARD.PITCH)) < 1e-9);
    const f = X.rooms.find((r) => r.id === om.roomId).lab.bridge, a = worldToBridge(f, p.x, p.z), b = worldToBridge(f, om.x, om.z);
    assert.ok(Math.hypot(a.u - b.u, a.v - b.v) < 3.2, '주인 시퀀서 곁(3.2m 안)');
    // 3D 판은 늘 jobAnchor 'rig' 자리(시퀀서 앞 — 몸체에 가리지 않게). 경사로 앞을 벗어난 시퀀서(k ≥ 2)는 2D 칩 줄도 그대로 ·
    // 경사로 뒤(k 0·1)는 2D 칩 줄만 시퀀서 몸체 뒤(+u, d2 음수)
    const g = jobAnchor({ ...om, type: 'rig' });
    assert.ok(Math.abs(p.x - g.x) < 1e-9 && Math.abs(p.z - g.z) < 1e-9, id + ' 3D 판 = 앞 자리');
    assert.ok(a.u < b.u, id + ' 판은 시퀀서 앞(중심 쪽)');
    const c = jobFlatPos(p), cu = worldToBridge(f, c.x, c.z).u;
    if (om.slot >= 2) assert.equal(p.d2, g.d2, id + ' 칩 줄 그대로');
    else assert.ok(p.d2 < 0 && cu > b.u + 0.8, id + ' 2D 칩 줄은 시퀀서 몸체 뒤');
  }
  // 첫 칸 카드는 작업 수와 무관하게 같은 자리(칸 상한 MAX 기준으로 자리를 정함)
  for (const [id, p] of A.machine) if (p.type === 'job' && p.slot === 0) { const q = Bm.machine.get(id); assert.ok(Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.z - p.z) < 1e-9 && q.d2 === p.d2, id); }
});

test('일반 기자재·팀장·직원 카드는 그대로(lab-marks (b)(c) 기대값)', () => {
  const ns = [{ id: 'main', kind: 'main', status: 'active', order: 0 }, { id: 'sa', kind: 'subagent', parentId: 'main', status: 'active', order: 1 },
    { id: 'bg1', kind: 'bash-bg', parentId: 'sa', status: 'active', order: 2, meta: { command: 'npm test' } },
    { id: 'L', kind: 'bash-bg', parentId: 'main', status: 'active', order: 3, meta: { launcher: { script: 'r.sh' } } },
    ...jobsFor('bg1', 3), ...jobsFor('L', 3)];
  const L = computeLab(ns, 'main'), rig = L.machine.get('bg1'), a = jobAnchor(rig);
  for (const [, p] of L.machine) if (p.type === 'job' && p.owner === 'bg1') {
    assert.ok(Math.abs(p.x - a.x) < 1e-9 && Math.abs(p.z - a.z) < 1e-9 && p.face === a.face && p.d2 === a.d2 && p.pole === a.pole);
  }
});
