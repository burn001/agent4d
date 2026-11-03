// node --test "web/test/lab-dyn-rigs.test.mjs" 기자재 동작(과제 A): RigDyn(활동 지수·누적 위상·전이) · 종류별 가동 부품 · 전이 연출 ·
// 상자 상한 · 하위 호환 스냅샷(dyn = null) · 할당 0 · 움직임 줄이기 · 2D rigLook 재사용. three·DOM 없음(lab-rig-core·lab2d-core 만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, LAB_PERF } from '../lab/lab-const.mjs';
import {
  RIG_KINDS, RIG_STATES, RIG_HEX, RIG_DYN, newRigDyn, rigDynStep, rigTransK, rigModel, rigParts, _lampForTest,
} from '../lab/lab-rig-core.mjs';
import { rigLook } from '../lab/lab2d-core.mjs';

const NOW = 2_000_000_000;
const NODES = {
  run: { id: 'r', status: 'active', meta: { run: { kind: 'bg', since: NOW - 5000, lastOut: NOW - 1000, staleAfter: 600_000 } } },
  wait: { id: 'w', status: 'idle', meta: {} },
  stale: { id: 's', status: 'active', meta: { run: { kind: 'bg', since: NOW - 4e6, lastOut: NOW - 3e6, staleAfter: 600_000 } } },
  done: { id: 'd', status: 'done', endedAt: NOW - 500, meta: {} },
  fail: { id: 'f', status: 'error', endedAt: NOW - 500, meta: { run: { kind: 'bg', rc: 2, ended: NOW - 500 } } },
  stop: { id: 'x', status: 'stopped', endedAt: NOW - 300, meta: {} },
};
const SEQ = { band: [1, 2, 4, 2, 1], progress: 0.4, running: 1 };
const seqExtra = (kind) => (kind === 'sequencer' ? SEQ : null);
const IXS = [null, { pass: 5, fail: 2, total: 20, i: 7, n: 12, par: 3, bytes: 1e6, rows: 5e4, rw: 'w', op: 'tunnel' }, { pass: 20, fail: 0, total: 20, i: 12, n: 12, par: 9, rw: 'r' }, { rw: 'w', bytes: 5e5, par: 3 }];
const TRANS = [null, 'on', 'resume', 'done', 'fail', 'stale', 'stop'];
const FRAME = 1 / 60;

/** 펄스(flash 1 → 0, 0.35초) 시각 목록으로 rigDynStep 을 60fps 로 돌림 */
function drive(d, t0, t1, pulses = [], state = 'run', ts = 1, reduced = false) {
  let t = t0;
  for (; t <= t1 + 1e-9; t += FRAME) {
    let fl = 0;
    for (const p of pulses) if (t >= p && t - p < 0.35) fl = Math.max(fl, 1 - (t - p) / 0.35);
    rigDynStep(d, t, fl, state, ts, reduced);
  }
  return t;
}
/** k 진행 중 전이를 직접 만든 dyn */
function dynWith(state, trans, k = 0.3, now = 10, o = {}) {
  const d = newRigDyn();
  d.state = state; d.lastT = now; d.ts = 1;
  if (trans) { d.trans = trans; d.t0 = now - k * RIG_DYN.TRANS_S[trans]; }
  Object.assign(d, o);
  return d;
}

test('1) 활동 지수 act: 2초 동안 0.4초 간격 펄스 5번 → ≥ 0.6, 그 뒤 6초 조용 → ≤ 0.15', () => {
  const d = newRigDyn();
  const end = drive(d, 0, 2, [0.01, 0.41, 0.81, 1.21, 1.61]);
  assert.equal(d.pulses, 5, '상승 가장자리 5번');
  assert.ok(d.act >= 0.6, 'act ' + d.act.toFixed(3));
  drive(d, end, end + 6);
  assert.ok(d.act <= 0.15, 'act ' + d.act.toFixed(3));
  assert.ok(d.act > 0, '멈추지는 않음(지수 감쇠)');
});

test('2) 위상 연속: act 를 0 → 1 로 바꿔도 한 프레임 Δph ≤ (SPEED_MIN + SPEED_K)·0.25', () => {
  const d = newRigDyn();
  drive(d, 0, 2);
  const cap = (RIG_DYN.SPEED_MIN + RIG_DYN.SPEED_K) * 0.25 * 1 + 1e-9;
  let last = 2;
  for (const dt of [FRAME, 0.1, 0.25, 3, 100]) { // 큰 dt 도 0.25 로 자름
    const ph0 = d.ph; d.act = 1;
    last += dt; rigDynStep(d, last, 0, 'run');
    assert.ok(d.ph - ph0 <= cap, `dt ${dt}: Δph ${(d.ph - ph0).toFixed(4)}`);
    assert.ok(d.ph >= ph0, '위상은 줄지 않음');
  }
  // 되감기(now 가 뒤로) — dt 0, 위상 그대로
  const ph1 = d.ph; rigDynStep(d, 1, 0, 'run'); assert.equal(d.ph, ph1);
});

test('3) 속도: 같은 3초 동안 act≈1 의 ph 증가 ≥ act≈0.05 의 2배', () => {
  const busy = newRigDyn(), calm = newRigDyn();
  drive(busy, 0, 1); drive(calm, 0, 1);
  const pulses = []; for (let p = 1; p < 4; p += 0.2) pulses.push(p);
  busy.act = 1; calm.act = 0.05;
  const b0 = busy.ph, c0 = calm.ph;
  drive(busy, 1 + FRAME, 4, pulses); drive(calm, 1 + FRAME, 4);
  const db = busy.ph - b0, dc = calm.ph - c0;
  assert.ok(db >= 2 * dc, `바쁨 ${db.toFixed(3)} / 조용 ${dc.toFixed(3)}`);
  assert.ok(dc > 0, '조용해도 SPEED_MIN 으로 돎');
});

test('4) 전이: 처음 run = on · run → done(1.4초, 배속 4 = 0.7초) 뒤 위상 정지 · wait → run = resume · stale 감속', () => {
  const d = newRigDyn();
  rigDynStep(d, 0, 0, 'run');
  assert.equal(d.trans, 'on', '설치 직후 시동');
  assert.equal(rigTransK(d, 0), 0);
  assert.ok(Math.abs(rigTransK(d, 0.45) - 0.5) < 1e-9, 'on 0.9초');
  drive(d, FRAME, 1);
  assert.equal(d.trans, null, '시동 끝');
  rigDynStep(d, 1.01, 0, 'done');
  assert.equal(d.trans, 'done'); assert.equal(d.from, 'run');
  assert.ok(rigTransK(d, 1.01) < 0.01);
  assert.ok(Math.abs(rigTransK(d, 1.01 + 0.7) - 0.5) < 1e-9);
  const sp0 = d.sp0; assert.ok(sp0 > 0, '감속 시작 속도');
  drive(d, 1.01 + FRAME, 2.5, [], 'done');
  assert.equal(rigTransK(d, 2.5), 1);
  const ph = d.ph; drive(d, 2.5 + FRAME, 4, [], 'done');
  assert.equal(d.ph, ph, '끝 뒤 위상 정지');
  // 배속 4: 0.7초
  const q = newRigDyn(); rigDynStep(q, 0, 0, 'run', 4); drive(q, FRAME, 1, [], 'run', 4);
  rigDynStep(q, 1, 0, 'done', 4);
  assert.ok(Math.abs(rigTransK(q, 1.35) - 0.5) < 1e-9, 'ts 4 = 0.7초');
  assert.equal(rigTransK(q, 1.7), 1);
  // wait → run = resume(0.5초)
  const w = newRigDyn(); rigDynStep(w, 0, 0, 'wait');
  assert.equal(w.trans, null, '처음 wait 은 전이 없음');
  rigDynStep(w, 1, 0, 'run'); assert.equal(w.trans, 'resume');
  assert.ok(Math.abs(rigTransK(w, 1.25) - 0.5) < 1e-9);
  // stale → run = resume · done → run(되감기) = on
  const s = newRigDyn(); rigDynStep(s, 0, 0, 'stale'); rigDynStep(s, 1, 0, 'run'); assert.equal(s.trans, 'resume');
  const r = newRigDyn(); rigDynStep(r, 0, 0, 'done'); rigDynStep(r, 1, 0, 'run'); assert.equal(r.trans, 'on');
  // run → stale: 2초에 걸쳐 STALE_SPEED 까지, 2.3초마다 덜컥
  const z = newRigDyn(); z.act = 1; drive(z, 0, 1);
  rigDynStep(z, 1 + FRAME, 0, 'stale'); assert.equal(z.trans, 'stale');
  const mid = z.sp0; drive(z, 1 + 2 * FRAME, 2, [], 'stale');
  assert.ok(z.sp < mid && z.sp > RIG_DYN.STALE_SPEED, '늦춰지는 중 ' + z.sp);
  drive(z, 2 + FRAME, 3.2, [], 'stale');
  assert.ok(Math.abs(z.sp - RIG_DYN.STALE_SPEED) < 1e-9, '정체 속도');
  const j0 = z.ph; drive(z, 3.2 + FRAME, 3.8, [], 'stale');
  assert.ok(z.ph - j0 > 0.25, '2.3초 덜컥(+0.25)');
  // → fail · → stop
  const f = newRigDyn(); rigDynStep(f, 0, 0, 'run'); rigDynStep(f, 1, 0, 'fail'); assert.equal(f.trans, 'fail'); assert.equal(f.sp, 0);
  const o = newRigDyn(); rigDynStep(o, 0, 0, 'run'); rigDynStep(o, 1, 0, 'stop'); assert.equal(o.trans, 'stop');
  // run → wait: 전이 없음
  const v = newRigDyn(); rigDynStep(v, 0, 0, 'run'); drive(v, FRAME, 1); rigDynStep(v, 1.1, 0, 'wait'); assert.equal(v.trans, null);
});

/** 상자 목록 sanity — NaN 없음, 바닥 위, 단단한 상자는 H_MAX 아래, 회전 없는 상자는 발자국 안 */
function sane(out, n, kind, tag) {
  const half = kind === 'sequencer' ? 0.9 : LAB.RIG.SIZE / 2 + 1e-6, keys = new Set(Object.keys(RIG_HEX.dark));
  for (let i = 0; i < n; i++) {
    const p = out[i];
    for (const v of [p.x, p.y, p.z, p.sx, p.sy, p.sz, p.r, p.k]) assert.ok(Number.isFinite(v), `${tag} NaN`);
    assert.ok(keys.has(p.c), `${tag} 색 키 ${p.c}`);
    assert.ok(p.sx > 0 && p.sy > 0 && p.sz > 0, `${tag} 크기`);
    if (!p.r) {
      assert.ok(Math.abs(p.x) + p.sx / 2 <= half + 0.02, `${tag} x 발자국 ${p.x} ${p.sx} ${p.c}`);
      assert.ok(Math.abs(p.z) + p.sz / 2 <= half + 0.02, `${tag} z 발자국 ${p.z} ${p.sz} ${p.c}`);
    }
    if (!p.g && p.c !== 'smoke') assert.ok(p.y + p.sy / 2 <= LAB.RIG.H_MAX + 1e-6, `${tag} 높이 ${p.y + p.sy / 2} ${p.c}`);
    assert.ok(p.y - p.sy / 2 >= -1e-6, `${tag} 바닥 아래 ${p.c}`);
  }
}

test('5) 상자 상한: 10종 × 6상태 × 전이(없음·각 k 0.3) × 원경 × dyn(없음·있음) × 세부 모두 ≤ 40(원경 ≤ 6) · 모양 sanity', () => {
  const out = [], now = 10;
  let cnt = 0, maxN = 0;
  for (const kind of RIG_KINDS) for (const [sk, node] of Object.entries(NODES)) for (const ix of IXS) for (const tr of TRANS) for (const far of [false, true]) for (const mid of [false, true]) for (const withDyn of [false, true]) {
    if (!withDyn && (tr || mid)) continue;
    const M = rigModel(node, kind, NOW, ix, seqExtra(kind), {});
    M.flash = 0.5; M.mid = mid;
    const d = withDyn ? dynWith(sk, tr, 0.3, now, { act: 1, pulseAt: now - 0.1, ph: 3.7, phS: 3.7, phq: 2.1, pqS: 2.1, ph2: 0.3, tape: 0.28 }) : null;
    for (const t of [0, 1.1, 7.3]) {
      const n = rigParts(M, t, out, far, 0.7, d, now);
      const cap = far ? LAB_PERF.RIG_BOXES_FAR : LAB_PERF.RIG_BOXES;
      assert.ok(n <= cap, `${kind}/${sk}/${tr}/far=${far} 상자 ${n}`);
      if (!far) maxN = Math.max(maxN, n);
      sane(out, n, kind, `${kind}/${sk}/${tr}/far=${far}`);
      cnt++;
    }
  }
  assert.ok(cnt > 5000);
  assert.ok(maxN <= LAB_PERF.RIG_BOXES);
  // 보조 선반·승강판도 상한 안
  for (const kind of RIG_KINDS) {
    const M = rigModel(NODES.fail, kind, NOW, IXS[1], seqExtra(kind), {}); M.scale = 0.6; M.lift = 0.5;
    assert.ok(rigParts(M, 0.3, out, false, 0.2, dynWith('fail', 'fail', 0.2), 10) <= LAB_PERF.RIG_BOXES);
  }
});

test('6) 움직임 서명: 10종 모두 run 에서 ph 0 ↔ 0.5 로 어떤 상자가 ≥ 0.05m 움직임 · wait 은 ph 가 바뀌어도 그대로', () => {
  const a = [], b = [];
  const snap = (src, n) => { const r = []; for (let i = 0; i < n; i++) { const p = src[i]; r.push([p.x, p.y, p.z, p.sx, p.sy, p.sz, p.r, p.c, p.g, p.k]); } return r; };
  for (const kind of RIG_KINDS) {
    const M = rigModel(NODES.run, kind, NOW, null, seqExtra(kind), {});
    assert.equal(M.state, 'run');
    const d = dynWith('run', null, 0, 10, { act: 0.5 });
    d.ph = 0; const n1 = rigParts(M, 1.1, a, false, 0.7, d, 10); const A = snap(a, n1);
    d.ph = 0.5; const n2 = rigParts(M, 1.1, b, false, 0.7, d, 10); const B = snap(b, n2);
    let mv = n1 !== n2 ? 1 : 0;
    for (let i = 0; i < Math.min(n1, n2); i++) mv = Math.max(mv, Math.abs(A[i][0] - B[i][0]), Math.abs(A[i][1] - B[i][1]), Math.abs(A[i][2] - B[i][2]));
    assert.ok(mv >= 0.05, `${kind} 움직임 ${mv.toFixed(3)}m`);
    // wait: 멈춘 자리(phS) 그대로 — ph 만 바꿔도 같은 출력
    const W = rigModel(NODES.wait, kind, NOW, null, seqExtra(kind), {});
    const w = dynWith('wait', null, 0, 10, { phS: 0.2, pqS: 0.2 });
    w.ph = 0; const m1 = rigParts(W, 1.1, a, false, 0.7, w, 10); const C = snap(a, m1);
    w.ph = 0.5; const m2 = rigParts(W, 1.1, b, false, 0.7, w, 10); const D = snap(b, m2);
    assert.deepEqual(D, C, `${kind} wait 은 위상과 무관`);
  }
});

test('7) 실패 흔들림: k 0.2 이면 몸통 상자 x 가 dyn 없을 때와 다름, k 0.8 이면 같음 · 붉은 섬광(k > 1) · 불꽃 6', () => {
  const out = [], now = 1 + Math.PI / 176; // sin(now·88) ≈ 1
  assert.ok(Math.abs(Math.sin(now * 88)) > 0.5);
  for (const kind of RIG_KINDS) {
    const M = rigModel(NODES.fail, kind, NOW, null, seqExtra(kind), {});
    rigParts(M, 0.3, out, false, 0.7); const x0 = out[0].x;
    rigParts(M, 0.3, out, false, 0.7, dynWith('fail', 'fail', 0.2, now), now);
    assert.ok(Math.abs(out[0].x - x0) > 0.01, `${kind} 흔들림 ${out[0].x}`);
    rigParts(M, 0.3, out, false, 0.7, dynWith('fail', 'fail', 0.8, now), now);
    assert.equal(out[0].x, x0, `${kind} k 0.8 = 제자리`);
  }
  const M = rigModel(NODES.fail, 'meter', NOW, null, null, {});
  const n = rigParts(M, 0.3, out, false, 0.7, dynWith('fail', 'fail', 0.1, now), now);
  let hot = 0, sparks = 0;
  for (let i = 0; i < n; i++) { const p = out[i]; if (p.g && p.c === 'fail' && p.k > 1.5) hot++; if (p.g && Math.abs(p.sx - 0.06) < 1e-9 && p.sx === p.sy) sparks++; }
  assert.ok(hot >= 4, '흰 → 빨강 섬광(받침 4변) ' + hot);
  assert.equal(sparks, 6, '불꽃 6');
  M.mid = true; // 중경: 불꽃 생략
  const nm = rigParts(M, 0.3, out, false, 0.7, dynWith('fail', 'fail', 0.1, now), now);
  sparks = 0; for (let i = 0; i < nm; i++) { const p = out[i]; if (p.g && Math.abs(p.sx - 0.06) < 1e-9 && p.sx === p.sy) sparks++; }
  assert.equal(sparks, 0, '중경 = 불꽃 없음');
});

// 바꾸기 전(v0.7.4 lab-rig-core) rigParts 출력의 지문: [상세 n, fnv(상세), 원경 n, fnv(원경)] — t 1.1, seed 0.7, flash 0.5
const SNAP = {
  'tests/run': [23, '19fdae81', 6, '60fdfd69'], 'tests/done': [28, 'f4ed920f', 6, '264f0d33'], 'tests/fail': [31, 'e1f0b4c5', 6, '5e46342a'],
  'tank/run': [18, '6c76af57', 6, 'e667b786'], 'tank/done': [18, '5d52a924', 6, 'd4a29da4'], 'tank/fail': [22, '47988fe9', 6, 'bf06084d'],
  'sequencer/run': [16, 'b98e05af', 6, '9a6f14c7'], 'sequencer/done': [20, 'd7f9c1b0', 6, 'c1c9ad2b'], 'sequencer/fail': [24, '3e8f7083', 6, '792d488e'],
};
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
function ser(out, n) { let s = ''; for (let i = 0; i < n; i++) { const p = out[i]; s += [p.x, p.y, p.z, p.sx, p.sy, p.sz, p.r, p.k].map((v) => v.toFixed(4)).join(',') + p.c + p.g + ';'; } return s; }

test('8) 하위 호환: dyn = null 이면 바꾸기 전 출력과 같음(3종 × 3상태 지문)', () => {
  const out = [], IX = { pass: 5, fail: 2, total: 20, i: 7, n: 12, par: 3, bytes: 1e6, rows: 5e4, rw: 'w' };
  for (const [key, want] of Object.entries(SNAP)) {
    const [kind, sk] = key.split('/');
    const M = rigModel(NODES[sk], kind, NOW, IX, seqExtra(kind), {});
    M.flash = 0.5;
    const n = rigParts(M, 1.1, out, false, 0.7), h = fnv(ser(out, n));
    const nf = rigParts(M, 1.1, out, true, 0.7), hf = fnv(ser(out, nf));
    assert.deepEqual([n, h, nf, hf], want, key);
    // 인자를 더 줘도 dyn 이 null 이면 같음
    const n2 = rigParts(M, 1.1, out, false, 0.7, null, 99);
    assert.deepEqual([n2, fnv(ser(out, n2))], [want[0], want[1]], key + ' (dyn null, now)');
  }
});

test('9) 할당 0: out 객체 identity 유지 · 1만 번 호출에 out 길이 그대로 · 표시등은 모듈 객체 · rigDynStep 은 같은 d', () => {
  const out = [];
  const M = rigModel(NODES.fail, 'tests', NOW, IXS[1], null, {});
  const d = dynWith('fail', 'fail', 0.1, 10);
  const n = rigParts(M, 0.3, out, false, 0.7, d, 10);
  const ids = out.slice(0, n);
  rigParts(M, 0.4, out, false, 0.7, d, 10.05);
  for (let i = 0; i < n; i++) assert.equal(out[i], ids[i], 'out[' + i + '] 재사용');
  // 최대 모양으로 데운 뒤 1만 번
  for (const kind of RIG_KINDS) for (const sk of RIG_STATES) rigParts(rigModel(NODES[sk], kind, NOW, IXS[1], seqExtra(kind), {}), 0, out, false, 0.7, dynWith(sk, sk === 'run' ? 'on' : sk, 0.2, 10, { act: 1, pulseAt: 9.9 }), 10);
  const len = out.length;
  assert.ok(len <= LAB_PERF.RIG_BOXES);
  const R = rigModel(NODES.run, 'reactor', NOW, null, null, {}), q = newRigDyn();
  for (let i = 0; i < 10000; i++) {
    const t = i * FRAME;
    assert.equal(rigDynStep(q, t, i % 30 === 0 ? 1 : 0, i < 5000 ? 'run' : 'done'), q);
    rigParts(R, t, out, i % 7 === 0, 0.7, q, t);
  }
  assert.equal(out.length, len, 'out 길이 그대로');
  const L1 = _lampForTest(M, 0.1), L2 = _lampForTest(R, 0.2);
  assert.equal(L1, L2, 'lamp = 모듈 객체');
});

test('10) 움직임 줄이기: 위상·act 고정, rigTransK = 1, 전이 없음, 입자 없음', () => {
  const d = newRigDyn();
  drive(d, 0, 1, [0.5], 'run', 1, true);
  assert.equal(d.ph, 0); assert.equal(d.act, 0); assert.equal(d.trans, null);
  assert.equal(rigTransK(d, 0.5), 1);
  rigDynStep(d, 1.1, 0, 'done', 1, true);
  assert.equal(d.trans, null); assert.equal(rigTransK(d, 1.2), 1); assert.equal(d.state, 'done');
  // 진행 중 전이가 있어도 reduced 면 1
  const e = dynWith('run', 'on', 0.1, 10); e.reduced = true;
  assert.equal(rigTransK(e, 10), 1);
  // 반응로 연기(입자) 없음
  const out = [], M = rigModel(NODES.run, 'reactor', NOW, null, null, {});
  const r = newRigDyn(); rigDynStep(r, 1, 0, 'run', 1, true);
  const n = rigParts(M, 1, out, false, 0.7, r, 1);
  for (let i = 0; i < n; i++) assert.notEqual(out[i].c, 'smoke', '연기 없음');
});

test('종류별 가동·전이 연출: 시험관 펑·LED 막대·기록지·방울·신호 고리·로봇 팔·덮개·배출·원경 가동', () => {
  const out = [], find = (n, pred) => { for (let i = 0; i < n; i++) if (pred(out[i])) return out[i]; return null; };
  const all = (n, pred) => { const r = []; for (let i = 0; i < n; i++) if (pred(out[i])) r.push({ ...out[i] }); return r; };
  // 시험대: pass 가 늘면 그 관이 0.4초 k 1.6, 스캐너 헤드
  const d = dynWith('run', null, 0, 10);
  rigParts(rigModel(NODES.run, 'tests', NOW, { pass: 3, fail: 0, total: 8 }, null, {}), 0, out, false, 0, d, 10);
  let n = rigParts(rigModel(NODES.run, 'tests', NOW, { pass: 4, fail: 0, total: 8 }, null, {}), 0, out, false, 0, d, 10.1);
  assert.ok(find(n, (p) => p.g && p.c === 'done' && p.k === 1.6), '통과 관 펑');
  assert.ok(find(n, (p) => p.g && p.c === 'trace' && p.sz === 1.0), '스캐너 헤드');
  n = rigParts(rigModel(NODES.run, 'tests', NOW, { pass: 4, fail: 1, total: 8 }, null, {}), 0, out, false, 0, d, 10.2);
  assert.ok(find(n, (p) => p.g && p.c === 'fail' && p.k === 1.6), '실패 관 펑');
  n = rigParts(rigModel(NODES.run, 'tests', NOW, { pass: 4, fail: 1, total: 8 }, null, {}), 0, out, false, 0, d, 10.7);
  assert.ok(!find(n, (p) => p.k === 1.6), '0.4초 뒤 끝');
  // 오실로: 출력 직후 LED 막대가 높고 0.5초 감쇠
  const led = (age) => { const o = dynWith('run', null, 0, 10, { pulseAt: 10 - age }); const m = rigParts(rigModel(NODES.run, 'oscillo', NOW, null, null, {}), 0, out, false, 0, o, 10); return all(m, (p) => p.g && p.c === 'trace' && Math.abs(p.sx - 0.045) < 1e-9); };
  const l0 = led(0.01), l1 = led(1.5);
  assert.equal(l0.length, 3); assert.ok(l0[0].sy > 0.35 && l0[0].sy > l0[1].sy && l0[1].sy > l0[2].sy, 'LED 1 > 0.7 > 0.45');
  assert.ok(l1[0].sy < 0.08, '감쇠');
  // 계측기: 기록지 = 펄스마다 2cm(0.3 순환)
  const t0 = newRigDyn(); const pls = []; for (let i = 0; i < 16; i++) pls.push(0.5 + i * 0.5);
  drive(t0, 0, 9, pls);
  assert.equal(t0.pulses, 16); assert.ok(Math.abs(t0.tape - ((16 * 0.02) % 0.3)) < 1e-9, '기록지 순환 ' + t0.tape);
  n = rigParts(rigModel(NODES.run, 'meter', NOW, null, null, {}), 0, out, false, 0, t0, 9);
  assert.ok(find(n, (p) => !p.g && p.c === 'paper' && Math.abs(p.sz - (0.04 + t0.tape)) < 1e-9), '기록지 띠');
  // 계측기 끝: 끊어 낸 기록지가 떨어짐
  const md = (k) => { const m = rigParts(rigModel(NODES.done, 'meter', NOW, null, null, {}), 0, out, false, 0, dynWith('done', 'done', k, 10), 10); return find(m, (p) => !p.g && p.c === 'paper' && Math.abs(p.sz - 0.15) < 1e-9); };
  assert.ok(md(0.1).y > md(0.9).y, '기록지 낙하');
  // 분주 로봇: 펄스 0.4초 안 방울
  const drop = (age) => find(rigParts(rigModel(NODES.run, 'dispenser', NOW, null, null, {}), 0, out, false, 0, dynWith('run', null, 0, 10, { pulseAt: 10 - age }), 10), (p) => p.g && p.c === 'liquid' && Math.abs(p.sx - 0.05) < 1e-9);
  assert.ok(drop(0.1) && !drop(0.6), '방울 0.4초');
  // 안테나: 사각 신호 고리 2(진행·터널 아님)
  n = rigParts(rigModel(NODES.run, 'antenna', NOW, null, null, {}), 0, out, false, 0, dynWith('run', null, 0, 10, { ph2: 0.2 }), 10);
  assert.equal(all(n, (p) => p.g && p.c === 'accent' && Math.abs(p.sz - 0.02) < 1e-9).length, 2, '신호 고리 2');
  // 안테나 신호 위상은 활동에 따라 빨라짐
  const slow = newRigDyn(), fast = newRigDyn(); drive(slow, 0, 2); fast.act = 1; drive(fast, 0, 2);
  assert.ok(fast.ph2 > slow.ph2 * 1.5);
  // 스코프: 출력 뒤 0.3초 멈칫(phq 정지)
  const sc = newRigDyn(); drive(sc, 0, 1); const q0 = sc.phq; drive(sc, 1 + FRAME, 1.2, [1 + FRAME]);
  assert.ok(sc.phq - q0 < 0.02 && sc.ph - q0 > 0.1, '스윕 멈칫');
  // 시퀀서: 로봇 팔 집게가 트레이 ↔ 대시보드
  const grip = (ph) => find(rigParts(rigModel(NODES.run, 'sequencer', NOW, null, SEQ, {}), 0, out, false, 0, dynWith('run', null, 0, 10, { ph }), 10), (p) => !p.g && p.c === 'metal' && Math.abs(p.sy - 0.16) < 1e-9).z;
  assert.ok(grip(0) - grip(Math.PI / 1.5) > 0.5, '집게 이동');
  // 중지: 먼지 덮개가 위에서 내려앉음
  const cover = (k) => find(rigParts(rigModel(NODES.stop, 'tests', NOW, null, null, {}), 0, out, false, 0, k == null ? null : dynWith('stop', 'stop', k, 10), 10), (p) => !p.g && p.c === 'stop').y;
  assert.ok(cover(0.1) > cover(0.6) && cover(0.6) > cover(null) - 1e-9 && Math.abs(cover(0.999) - cover(null)) < 0.01, '덮개 내려옴');
  // 끝: 시험 결과 카드 밀려 나옴 · 배양기 결정 떠오름 · 분주 웰 섬광
  const card = (k) => find(rigParts(rigModel(NODES.done, 'tests', NOW, null, null, {}), 0, out, false, 0, dynWith('done', 'done', k, 10), 10), (p) => !p.g && p.c === 'paper').z;
  assert.ok(card(0.9) - card(0.05) > 0.2, '결과 카드 배출');
  const cry = (k) => find(rigParts(rigModel(NODES.done, 'incubator', NOW, null, null, {}), 0, out, false, 0, dynWith('done', 'done', k, 10), 10), (p) => p.c === 'crystal').y;
  assert.ok(cry(0.95) - cry(0.05) > 0.2, '결정 떠오름');
  const well = find(rigParts(rigModel(NODES.done, 'dispenser', NOW, null, null, {}), 0, out, false, 0, dynWith('done', 'done', 0.1, 10), 10), (p) => p.g && p.c === 'liquid');
  assert.ok(well.k > 1.5, '웰 섬광');
  // 시동: 김 2 + 상태등 깜빡
  n = rigParts(rigModel(NODES.run, 'meter', NOW, null, null, {}), 0, out, false, 0, dynWith('run', 'on', 0.1, 10), 10);
  assert.equal(all(n, (p) => p.g && p.c === 'smoke').length, 2, '시동 김 2');
  // 반응로 연기 수 ∝ act(1 + round(3·act)), 중경이면 생략
  const smoke = (act, mid) => { const M = rigModel(NODES.run, 'reactor', NOW, null, null, {}); M.mid = mid; const m = rigParts(M, 0, out, false, 0, dynWith('run', null, 0, 10, { act }), 10); return all(m, (p) => p.c === 'smoke').length; };
  assert.equal(smoke(0, false), 1); assert.equal(smoke(1, false), 4); assert.equal(smoke(1, true), 0);
  // 원경: 종류 부품 가동(상자 수 그대로) + 상태 기둥 높이 ∝ 활동
  for (const kind of RIG_KINDS) {
    const M = rigModel(NODES.run, kind, NOW, null, seqExtra(kind), {});
    const n0 = rigParts(M, 0, out, true, 0, dynWith('run', null, 0, 10, { ph: 0, act: 0 }), 10);
    const k0 = { ...find(n0, (p) => !p.g && p.c === 'kind') }, c0 = find(n0, (p) => p.g && p.sx < p.sy).sy;
    const n1 = rigParts(M, 0, out, true, 0, dynWith('run', null, 0, 10, { ph: 0.4, act: 1 }), 10);
    const k1 = find(n1, (p) => !p.g && p.c === 'kind'), c1 = find(n1, (p) => p.g && p.sx < p.sy).sy;
    assert.equal(n1, n0); assert.ok(n1 <= LAB_PERF.RIG_BOXES_FAR);
    assert.ok(Math.abs(k1.r - k0.r) > 0.1 || Math.abs(k1.y - k0.y) > 0.05, kind + ' 원경 가동');
    assert.ok(c1 > c0 * 1.5, kind + ' 기둥 ∝ 활동');
  }
});

test('11) 2D rigLook: 재사용 객체(같은 인자 두 번 = 같은 identity), 값은 그대로', () => {
  const node = { id: 'b', kind: 'bash-bg', status: 'error', meta: {} };
  const L1 = rigLook(node, 'tests', 5000, false, 1, 0, false);
  assert.equal(L1.state, 'fail'); assert.equal(L1.ring, RIG_HEX.dark.fail); assert.equal(L1.kind, 'tests');
  const L2 = rigLook(node, 'tests', 5000, false, 1, 0, false);
  assert.equal(L2, L1, 'identity');
  const L3 = rigLook({ id: 'c', kind: 'bash-bg', status: 'done', meta: {} }, 'meter', 5000, true, 1, 0, true);
  assert.equal(L3, L1); assert.equal(L3.state, 'done'); assert.equal(L3.ring, RIG_HEX.light.done); assert.equal(L3.anim, false);
});
