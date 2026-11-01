// node --test "web/test/lab-rig-vis.test.mjs" T2 기자재 가시성: 종류 악센트 색(RIG_KIND_HEX) · 원경 실루엣 LOD(종류마다 다른 3 상자) ·
// 보조 선반·원경 상태등 하한 · 상세 상자 상한 유지 · 비운 자리·승강판 상자(가짜 three 로 lab-rigs.js 를 불러 기록) · 상세 팝업 기자재 줄(rigCardModel)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { LAB, LAB_PERF } from '../lab/lab-const.mjs';
import { RIG_KINDS, RIG_STATES, RIG_HEX, RIG_KIND_HEX, LAMP_MIN_W, rigModel, rigParts } from '../lab/lab-rig-core.mjs';
import { rigCardModel } from '../inspector-core.mjs';
import { _setLangForTest as setLang } from '../i18n.mjs';

// lab-rigs.js 는 'three' 를 부른다 — 시험에서는 Color 만 있는 가짜로 바꾼다(브라우저·헤드리스 렌더링 없음)
const THREE_STUB = `export class Color {
  constructor(v = 0, g, b) { if (typeof v === 'string') { this.r = parseInt(v.slice(1, 3), 16) / 255; this.g = parseInt(v.slice(3, 5), 16) / 255; this.b = parseInt(v.slice(5, 7), 16) / 255; } else { this.r = v; this.g = g ?? v; this.b = b ?? v; } }
  clone() { return new Color(this.r, this.g, this.b); }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  multiplyScalar(k) { this.r *= k; this.g *= k; this.b *= k; return this; }
  lerp(c, a) { this.r += (c.r - this.r) * a; this.g += (c.g - this.g) * a; this.b += (c.b - this.b) * a; return this; }
}`;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: 'data:text/javascript,' + encodeURIComponent(THREE_STUB), shortCircuit: true };
    return next(spec, ctx);
  },
});
const { drawRig, drawRigVacant } = await import('../lab/lab-rigs.js');

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const NOW = 2_000_000_000;
const NODES = {
  run: { id: 'r', status: 'active', meta: { run: { kind: 'bg', since: NOW - 5000, lastOut: NOW - 1000, staleAfter: 600_000 } } },
  wait: { id: 'w', status: 'idle', meta: {} },
  stale: { id: 's', status: 'active', meta: { run: { kind: 'bg', since: NOW - 4e6, lastOut: NOW - 3e6, staleAfter: 600_000 } } },
  done: { id: 'd', status: 'done', endedAt: NOW - 500, meta: {} },
  fail: { id: 'f', status: 'error', endedAt: NOW - 500, meta: { run: { kind: 'bg', rc: 2, ended: NOW - 500 } } },
  stop: { id: 'x', status: 'stopped', endedAt: NOW - 300, meta: {} },
};
const IXS = [null, { pass: 5, fail: 2, total: 20, i: 7, n: 12, par: 3, bytes: 1e6, rows: 5e4, rw: 'w', op: 'tunnel' }, { pass: 20, fail: 0, total: 20, i: 12, n: 12, par: 9, rw: 'r' }];
const seqExtra = (kind) => (kind === 'sequencer' ? { band: [1, 2, 4, 2, 1], progress: 0.4, running: 1 } : null);

test('(a) RIG_KIND_HEX: 테마마다 10종이 서로 다르고 상태 6색과 다름(RGB 거리 ≥ 55)', () => {
  const MIN = 55;
  for (const th of ['dark', 'light']) {
    const K = RIG_KIND_HEX[th];
    assert.deepEqual(Object.keys(K).sort(), [...RIG_KINDS].sort(), th + ' 10종 모두');
    for (const k of RIG_KINDS) assert.match(K[k], /^#[0-9a-f]{6}$/i, `${th} ${k}`);
    for (let i = 0; i < RIG_KINDS.length; i++) {
      for (let j = i + 1; j < RIG_KINDS.length; j++) {
        const d = dist(K[RIG_KINDS[i]], K[RIG_KINDS[j]]);
        assert.ok(d >= MIN, `${th} ${RIG_KINDS[i]}–${RIG_KINDS[j]} 거리 ${d.toFixed(0)}`);
      }
      for (const s of RIG_STATES) {
        const d = dist(K[RIG_KINDS[i]], RIG_HEX[th][s]);
        assert.ok(d >= MIN, `${th} ${RIG_KINDS[i]}–상태 ${s} 거리 ${d.toFixed(0)}`);
      }
    }
    assert.ok(RIG_HEX[th].kind, th + " 색 키 'kind' 대체값");
  }
  // 몸통 밝기(다크): #4a5872 이상
  const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  assert.ok(lum(RIG_HEX.dark.body) >= lum('#4a5872') - 0.5, '다크 몸통이 밝아짐');
});

test('(b) 원경 LOD: 상자 ≤ RIG_BOXES_FAR(6) · 종류마다 실루엣 서명(단단한 상자 sx,sy,sz)이 다름 · 종류색 띠·발광 상태등', () => {
  assert.equal(LAB_PERF.RIG_BOXES_FAR, 6);
  assert.ok((LAB_PERF.RIGS_RING + LAB.RIG.SHELF_MAX) * LAB_PERF.RIG_BOXES_FAR <= LAB_PERF.RIG_BOXES_TOTAL);
  const out = [], sigs = new Map();
  for (const kind of RIG_KINDS) {
    for (const [sk, node] of Object.entries(NODES)) {
      const M = rigModel(node, kind, NOW, null, seqExtra(kind), {});
      const n = rigParts(M, 0.7, out, true);
      assert.ok(n >= 5 && n <= LAB_PERF.RIG_BOXES_FAR, `${kind}/${sk} LOD ${n}`);
      const solid = [];
      let band = false, lamp = false;
      for (let i = 0; i < n; i++) {
        const p = out[i];
        for (const v of [p.x, p.y, p.z, p.sx, p.sy, p.sz, p.r, p.k]) assert.ok(Number.isFinite(v), `${kind}/${sk} NaN`);
        if (!p.g) solid.push(`${p.sx.toFixed(2)}x${p.sy.toFixed(2)}x${p.sz.toFixed(2)}`);
        if (p.g && p.c === 'kind') band = true;
        if (p.g && p.c === sk && Math.min(p.sx, p.sy, p.sz) >= 0.35 - 1e-9) lamp = true;
      }
      assert.equal(solid.length, 3, `${kind} 실루엣 3 상자`);
      assert.ok(band, `${kind}/${sk} 종류색 띠`);
      assert.ok(lamp, `${kind}/${sk} 큰 상태등(0.35)`);
      const sig = solid.sort().join('|');
      if (sigs.has(kind)) assert.equal(sigs.get(kind), sig, `${kind} 실루엣은 상태와 무관`);
      sigs.set(kind, sig);
    }
  }
  assert.equal(new Set(sigs.values()).size, RIG_KINDS.length, '종류끼리 실루엣 서명이 모두 다름');
});

test('(c) 상태등 하한: 원경·보조 선반(scale 0.6)에서도 glow 상태등 한 변 ≥ 0.3/scale(세계 0.3) + 발광 기둥', () => {
  const out = [];
  for (const sc of [1, 0.6]) {
    for (const far of [true, false]) {
      if (!far && sc === 1) continue; // 고리 상세는 기존 0.2(가까움)
      for (const kind of RIG_KINDS) {
        for (const [sk, node] of Object.entries(NODES)) {
          const M = rigModel(node, kind, NOW, null, seqExtra(kind), {});
          M.scale = sc;
          const n = rigParts(M, 0.3, out, far);
          let lampW = 0, column = false;
          for (let i = 0; i < n; i++) {
            const p = out[i];
            if (!p.g || p.c !== sk) continue;
            if (Math.abs(p.sx - p.sy) < 1e-9 && Math.abs(p.sy - p.sz) < 1e-9) lampW = Math.max(lampW, p.sx); // 정육면체 = 상태등
            if (p.sy * sc >= 0.45 && p.sx < p.sy) column = true;                                        // 세로 기둥(세계 0.5)
          }
          assert.ok(lampW * sc >= LAMP_MIN_W - 1e-9, `${kind}/${sk} far=${far} sc=${sc} 상태등 세계 ${(lampW * sc).toFixed(3)}`);
          assert.ok(column, `${kind}/${sk} far=${far} sc=${sc} 발광 기둥`);
        }
      }
    }
  }
});

test('(d) 상세 상자 수 ≤ RIG_BOXES(40) 유지(10종 × 6상태 × 세부 × 위상 × 보조 선반) · M5 상태 테두리', () => {
  const out = [];
  let max = 0;
  for (const kind of RIG_KINDS) for (const [sk, node] of Object.entries(NODES)) for (const ix of IXS) for (const sc of [1, 0.6]) {
    const M = rigModel(node, kind, NOW, ix, seqExtra(kind), {});
    M.scale = sc; M.flash = 0.5;
    for (const t of [0, 0.37, 1.1, 2.9, 7.3, 123.4]) {
      const n = rigParts(M, t, out, false, 0.7);
      assert.ok(n <= LAB_PERF.RIG_BOXES, `${kind}/${sk} 상자 ${n}`);
      max = Math.max(max, n);
      // 앞 띠 높이 0.12(상태색) 는 늘 있음
      let band = false;
      for (let i = 0; i < n; i++) if (out[i].g && out[i].c === sk && Math.abs(out[i].sy - 0.12) < 1e-9 && out[i].sx > 1) band = true;
      assert.ok(band, `${kind}/${sk} 앞 띠 0.12`);
    }
  }
  assert.ok(max < LAB_PERF.RIG_BOXES, '상자 상한 여유 ' + max);
  const count = (M, pred, t = 0.1) => { const n = rigParts(M, t, out); let c = 0; for (let i = 0; i < n; i++) if (pred(out[i])) c++; return c; };
  // 실패: 받침 4변 붉은 발광
  const F = rigModel(NODES.fail, 'meter', NOW, null, null, {});
  assert.ok(count(F, (p) => p.g && p.c === 'fail' && p.y < 0.2 && (p.sx > 1.2 || p.sz > 1.2)) >= 4, '실패 = 받침 테두리 4변');
  // 끝: 초록 링(DONE_LIT_MS 안)만, 3초 뒤 없음
  const D = (age) => rigModel({ ...NODES.done, endedAt: NOW - age }, 'meter', NOW, null, null, {});
  assert.equal(count(D(300), (p) => p.g && p.c === 'done' && Math.abs(p.sy - 0.04) < 1e-9), 4, '끝 = 링 4변');
  assert.equal(count(D(3500), (p) => p.g && p.c === 'done' && Math.abs(p.sy - 0.04) < 1e-9), 0, '링은 한 번');
  // 중지: 회색 덮개
  const S = rigModel(NODES.stop, 'tests', NOW, null, null, {});
  assert.ok(count(S, (p) => !p.g && p.c === 'stop') >= 1, '중지 = 회색 덮개');
  // 상판·받침 = 종류색
  for (const kind of RIG_KINDS) assert.ok(count(rigModel(NODES.run, kind, NOW, null, seqExtra(kind), {}), (p) => !p.g && p.c === 'kind') >= 2, kind + ' 종류색 받침·상판');
});

/** 가짜 묶음: box 호출을 기록 */
function fakeB() {
  const rec = { lit: [], glow: [] };
  const mk = (arr) => ({ box(x, y, z, sx, sy, sz, c, r = 0) { arr.push({ x, y, z, sx, sy, sz, r: c && { r: c.r, g: c.g, b: c.b }, yaw: r }); } });
  return { rec, B: { lit: mk(rec.lit), glow: mk(rec.glow) } };
}
const PAL = { isLight: false };

test('(e) 비운 자리 상자 ≤ 8(테두리 4변 + X) · 승강판(lift 0.5) 경고 띠 + 표시등 기둥', () => {
  const slot = { x: 3, z: -2, face: 0.7 };
  const { rec, B } = fakeB();
  const n = drawRigVacant(slot, 0.6, PAL, B);
  assert.equal(n, rec.lit.length + rec.glow.length);
  assert.ok(n <= 8 && n >= 7, '비운 자리 상자 ' + n);
  for (const b of [...rec.lit, ...rec.glow]) assert.ok(Math.hypot(b.x - slot.x, b.z - slot.z) <= LAB.RIG.SIZE * 0.72, '자리 안');
  assert.ok(rec.lit.some((b) => Math.abs(b.sy - 0.04) < 1e-9), '판 높이 0.04');
  assert.ok(rec.glow.filter((b) => Math.abs(b.yaw - slot.face) > 0.5).length === 2, 'X 두 막대(±45°)');
  assert.equal(drawRigVacant(slot, 0, PAL, fakeB().B), 0, 'k 0 이면 안 그림');
  // k 비례: 남은 비율이 클수록 밝음
  const g = (k) => { const f = fakeB(); drawRigVacant(slot, k, PAL, f.B); return f.rec.glow[0].r.r + f.rec.glow[0].r.g + f.rec.glow[0].r.b; };
  assert.ok(g(1) > g(0.2));

  const pos = { x: 0, y: 0, z: 0, type: 'rig', face: 0.3, rigKind: 'tests' };
  const st = { t: 1.2, seed: 0.4, id: 'b1', appear: 1, flash: 0, lift: 0.5 };
  const L = fakeB();
  const m = drawRig(pos, st, PAL, {}, L.B, NODES.done, NOW);
  assert.ok(m > 0);
  const amber = (b) => b.r && b.r.r > b.r.b * 2 && b.r.g > b.r.b; // 호박색
  const stripes = L.rec.glow.filter((b) => Math.abs(b.y - 0.045) < 1e-9 && amber(b));
  assert.ok(stripes.length >= 8, '경고 띠 4변 × 2 토막 ' + stripes.length);
  assert.ok(L.rec.lit.some((b) => Math.abs(b.y - 0.02) < 1e-9 && b.sx >= LAB.RIG.SIZE - 1e-9), '어두운 승강판');
  assert.ok(L.rec.glow.some((b) => b.sy >= 0.4 && b.y - b.sy / 2 >= 0 && b.y - b.sy / 2 < 0.1), '판 위 표시등 기둥');
  const N = fakeB(); drawRig(pos, { ...st, lift: 0 }, PAL, {}, N.B, NODES.run, NOW);
  assert.equal(N.rec.glow.filter((b) => Math.abs(b.y - 0.045) < 1e-9 && amber(b)).length, 0, '승강판 아니면 경고 띠 없음');
  // 종류색: 'kind' 상자는 RIG_KIND_HEX 색으로 그려짐(받침)
  const kc = rgb(RIG_KIND_HEX.dark.tests).map((v) => v / 255);
  assert.ok(N.rec.lit.some((b) => b.r && Math.abs(b.r.r - kc[0]) < 1e-6 && Math.abs(b.r.g - kc[1]) < 1e-6 && Math.abs(b.r.b - kc[2]) < 1e-6), '받침 = 종류색');
  // 원경도 그려짐(6 이하) · 보조 선반
  const Fa = fakeB(); const nf = drawRig({ ...pos, scale: 0.6 }, { ...st, lift: 0, far: true }, PAL, {}, Fa.B, NODES.stale, NOW);
  assert.ok(nf <= LAB_PERF.RIG_BOXES_FAR && Fa.rec.lit.length + Fa.rec.glow.length === nf);
});

test('(f) rigCardModel: 실패 rc 2 → rc 줄 · 정체 → staleMin · 시퀀서 gauge · i18n', () => {
  for (const lang of ['ko', 'en']) {
    setLang(lang);
    const f = rigCardModel(NODES.fail, 'tests', NOW);
    assert.equal(f.state, 'fail'); assert.equal(f.rc, 2); assert.equal(f.kind, 'tests'); assert.ok(f.glyph);
    const rcRow = f.rows.find((r) => r.key === 'rc');
    assert.ok(rcRow && /2/.test(rcRow.value), lang + ' rc 줄');
    assert.ok(!/^lab\./.test(f.kindLabel) && !/^lab\./.test(f.stateLabel), lang + ' 문구 있음');
    for (const r of f.rows) assert.ok(!/^lab\./.test(r.label), lang + ' 줄 이름 ' + r.label);
    const s = rigCardModel(NODES.stale, 'meter', NOW);
    assert.equal(s.state, 'stale'); assert.equal(s.staleMin, 50);
    assert.ok(s.rows.find((r) => r.key === 'stale' && /50/.test(r.value)), lang + ' 정체 분');
    assert.equal(s.gauge, null);
    const q = rigCardModel({ id: 'l', kind: 'bash-bg', status: 'active', meta: { launcher: { script: 'x.sh' } } }, 'sequencer', NOW, null, { progress: 0.42 });
    assert.equal(q.gauge, 0.42);
    assert.equal(q.rows.find((r) => r.key === 'gauge').value, '42%');
    assert.equal(rigCardModel({ id: 'l', kind: 'bash-bg', status: 'active', meta: {} }, 'sequencer', NOW).gauge, null, '시퀀서 진행 모름');
    const t = rigCardModel(NODES.run, 'tests', NOW, { pass: 3, fail: 1, total: 8 });
    assert.equal(t.gauge, 0.5); assert.equal(t.rc, null); assert.equal(t.staleMin, null);
    assert.ok(!t.rows.some((r) => r.key === 'rc' || r.key === 'stale'));
    assert.equal(rigCardModel(NODES.done, 'nope', NOW).kind, 'meter', '모르는 종류 = 범용 계측기');
    assert.equal(rigCardModel(null, 'tests', NOW), null);
  }
  setLang('ko');
});
