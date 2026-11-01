// node --test "web/test/lab-rigs.test.mjs"   복셀 연구소 기자재(설계): 종류 판정(ix 범주·명령 글 규칙·한 번 정하면 유지) ·
// 상태 표(작업·rc·정체·서버 2배 문턱) · 진행률 · 모양(종류 × 상태: 상자 상한 40·LOD 3·발자국·높이·NaN 없음) · 승강판 · 보조 선반 · 자리 배정 · 성능
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, LAB_PERF, labRadii, dTheta } from '../lab/lab-const.mjs';
import {
  RIG_KINDS, RIG_STATES, RIG_HEX, RIG_GLYPH, RIGW, RIG_HEIGHT, rigKindOf, rigState, rigGauge, rigRc, rigModel, rigParts,
  rigIxOf, rigLiftK, rigLiftSec, rigSlots, rigShelfSlots, assignRigSlots, rigStaleMs,
} from '../lab/lab-rig-core.mjs';
import { MESSAGES } from '../i18n.mjs';

const bg = (command, meta = {}, extra = {}) => ({ id: 'b:' + command, kind: 'bash-bg', status: 'active', label: command, meta: { command, ...meta }, ...extra });

test('종류 판정: monitor·기동기·러너·분리 프로세스·ix 범주', () => {
  assert.equal(rigKindOf({ id: 'm1', kind: 'monitor' }), 'scope');
  assert.equal(rigKindOf({ id: 'l', kind: 'bash-bg', meta: { launcher: { script: 'x.sh' } } }), 'sequencer');
  assert.equal(rigKindOf({ id: 'r', kind: 'bash-bg', meta: { runner: { script: 'x.sh' } } }), 'sequencer');
  assert.equal(rigKindOf({ id: 'p', kind: 'bash-bg', meta: { proc: { pid: 1 } } }), 'incubator');
  const n = bg('do-something');
  assert.equal(rigKindOf(n, 'tests'), 'tests');
  assert.equal(rigKindOf(n, 'db'), 'tank');
  assert.equal(rigKindOf(n, 'remote'), 'antenna');
  assert.equal(rigKindOf(n, 'github'), 'antenna');
  assert.equal(rigKindOf(n, 'batch'), 'dispenser');
  assert.equal(rigKindOf(n, 'user'), 'meter', '모르는 범주는 글 규칙으로');
  assert.equal(rigKindOf({ kind: 'bash-bg' }), 'meter');
  assert.equal(rigKindOf(null), 'meter');
});

test('종류 판정: 명령 글 규칙(§4.2-2)', () => {
  const T = {
    tests: ['pytest -q tests/', 'npm test', 'npm run test:web', 'node --test web/test/*.mjs', 'cargo test', 'go test ./...', 'npx vitest run', 'make test', 'dotnet test'],
    reactor: ['npm run build', 'vite build', 'cargo build --release', 'tsc -p .', 'make -j8', 'pyinstaller app.spec', 'docker build -t x .', 'dotnet build'],
    oscillo: ['npm run dev', 'uvicorn app:app --reload', 'node server.mjs', 'python -m http.server 8000', 'wrangler dev', 'docker compose up', 'flask run', 'node bin/agent4d.mjs --port 7788'],
    tank: ['mongosh "mongodb://x" --eval "db.x.find()"', 'pg_dump mydb > d.sql', 'sqlite3 a.db ".tables"', 'mysqldump -u r db'],
    antenna: ['ssh build-host "ls"', 'scp a.txt host:/tmp', 'rsync -av a/ b/', 'git push origin main', 'gh pr checks 12 --watch', 'cloudflared tunnel run'],
    dispenser: ['ls *.txt | xargs -P 4 -n1 gzip', 'for f in *.hwp; do convert "$f"; done', 'parallel -j4 ./run.sh ::: a b', 'Get-ChildItem | ForEach-Object { x }'],
    scope: ['tail -f server.log', 'Get-Content log.txt -Wait', 'journalctl -u x -f'],
    incubator: ['python train.py --epochs 40', 'node bench.mjs', 'python scrape_all.py'],
    meter: ['ls -la', 'echo hi', 'python convert.py'],
  };
  for (const [kind, cmds] of Object.entries(T)) for (const c of cmds) assert.equal(rigKindOf(bg(c)), kind, `${c} → ${kind}`);
  // 라벨만 있어도(명령 없음)
  assert.equal(rigKindOf({ id: 'x', kind: 'bash-bg', label: 'npm run build' }), 'reactor');
  // 장시간: staleAfter ≥ 15분 · 버퍼링 python
  assert.equal(rigKindOf(bg('python job.py', { run: { kind: 'bg', since: 0, staleAfter: 1_200_000 } })), 'incubator');
  assert.equal(rigKindOf(bg('python job.py', { run: { kind: 'bg', since: 0, buffered: true } })), 'incubator');
  // ix 범주가 글 규칙보다 먼저
  assert.equal(rigKindOf(bg('npm run build'), 'tests'), 'tests');
  // 결정적(재생도 같은 답)
  for (const c of T.reactor) assert.equal(rigKindOf(bg(c)), rigKindOf(bg(c)));
});

test('상태 표(§4.4): 서버 상태 · rc · 작업 · 분리 프로세스 · 정체 · 서버 2배 문턱', () => {
  const now = 1_000_000_000;
  assert.equal(rigState({ status: 'active' }, now), 'run');
  assert.equal(rigState({ status: 'idle' }, now), 'wait');
  assert.equal(rigState({ status: 'done' }, now), 'done');
  assert.equal(rigState({ status: 'done', meta: { run: { kind: 'bg', rc: 2 } } }, now), 'fail', 'rc ≠ 0 끝 = 실패');
  assert.equal(rigState({ status: 'done', meta: { run: { kind: 'bg', rc: 0 } } }, now), 'done');
  assert.equal(rigState({ status: 'error' }, now), 'fail');
  assert.equal(rigState({ status: 'stopped' }, now), 'stop');
  assert.equal(rigState(null, now), 'stop');
  const job = (state, extra = {}) => ({ status: 'active', meta: { job: { state, beatAt: now, ...extra } } });
  assert.equal(rigState(job('queued'), now), 'wait');
  assert.equal(rigState(job('waiting'), now), 'wait');
  assert.equal(rigState(job('running'), now), 'run');
  assert.equal(rigState(job('done'), now), 'done');
  assert.equal(rigState(job('failed'), now), 'fail');
  assert.equal(rigState(job('running', { stale: true }), now), 'stale');
  assert.equal(rigState({ status: 'idle', meta: { proc: { pid: 1 } } }, now), 'stale', '§103 idle = 정체');
  // 정체: staleAfter 10분, 마지막 출력 15분 전
  const run = { kind: 'bg', since: now - 3_600_000, lastOut: now - 900_000, staleAfter: 600_000 };
  const n = { status: 'active', meta: { run } };
  assert.equal(rigState(n, now), 'stale');
  assert.equal(rigState(n, now, 'oscillo'), 'run', '서버는 문턱 2배(20분)까지 정상');
  assert.equal(rigState({ status: 'active', meta: { run: { ...run, lastOut: now - 1_500_000 } } }, now, 'oscillo'), 'stale');
  assert.ok(rigStaleMs(n, now) >= 900_000);
  assert.equal(rigRc({ meta: { proc: { rc: 3 } } }), 3);
  assert.equal(rigRc({ meta: {} }), null);
});

test('진행률(rigGauge): 시험·분주·탱크·안테나·pct·작업, 진행률 없는 기자재는 null', () => {
  const n = { status: 'active', meta: {} }, now = 0;
  assert.equal(rigGauge(n, 'tests', now, { pass: 30, fail: 10, total: 80 }), 0.5);
  assert.equal(rigGauge(n, 'dispenser', now, { i: 3, n: 12 }), 0.25);
  assert.ok(rigGauge(n, 'tank', now, { rows: 1e6 }) > 0.9);
  assert.ok(Math.abs(rigGauge(n, 'antenna', now, { bytes: 999_999 }) - 6 / 9) < 1e-3);
  assert.equal(rigGauge(n, 'reactor', now, { pct: 40 }), 0.4);
  assert.equal(rigGauge(n, 'reactor', now, null), null);
  assert.equal(rigGauge(n, 'oscillo', now, { pct: 40 }), null);
  assert.equal(rigGauge(n, 'scope', now, null), null);
  assert.equal(rigGauge({ status: 'active', meta: { job: { state: 'running', progress: { n: 2, total: 8 } } } }, 'incubator', now), 0.25);
  assert.equal(rigGauge(n, 'tests', now, { pass: 99, total: 10 }), 1, '0..1 로 자름');
});

test('ix 세부(rigIxOf): toolUseId 키 또는 bgNode', () => {
  const fx = new Map([['tu1', { ix: { cat: 'tests', pass: 3, total: 9 }, bgNode: null }], ['k2', { ix: { cat: 'batch', i: 2, n: 4 }, bgNode: 'b:2' }]]);
  assert.deepEqual(rigIxOf({ fx }, { id: 'b:1', meta: { toolUseId: 'tu1' } }), { cat: 'tests', pass: 3, total: 9 });
  assert.equal(rigIxOf({ fx }, { id: 'b:2', meta: {} }).n, 4);
  assert.equal(rigIxOf({ fx }, { id: 'b:3', meta: {} }), null);
  assert.equal(rigIxOf(null, { id: 'b:1' }), null);
});

/** 모든 종류 × 상태 × 위상 × 세부의 모델 */
function* allModels() {
  const now = 2_000_000_000;
  const ixs = [null, { pass: 5, fail: 2, total: 20, i: 7, n: 12, par: 3, bytes: 1e6, rows: 5e4, rw: 'w', op: 'tunnel' }, { pass: 20, fail: 0, total: 20, i: 12, n: 12, par: 9, rw: 'r' }];
  const nodes = {
    run: { status: 'active', meta: { run: { kind: 'bg', since: now - 5000, lastOut: now - 1000, staleAfter: 600_000 } } },
    wait: { status: 'idle', meta: {} },
    stale: { status: 'active', meta: { run: { kind: 'bg', since: now - 4e6, lastOut: now - 3e6, staleAfter: 600_000 } } },
    done: { status: 'done', endedAt: now - 500, meta: {} },
    fail: { status: 'error', endedAt: now - 500, meta: { run: { kind: 'bg', rc: 2, ended: now - 500 } } },
    stop: { status: 'stopped', endedAt: now - 300, meta: {} },
  };
  for (const kind of RIG_KINDS) for (const [sk, node] of Object.entries(nodes)) for (const ix of ixs) {
    const extra = kind === 'sequencer' ? { band: [1, 2, 4, 2, 1], progress: 0.4, running: 1 } : null;
    const M = rigModel(node, kind, now, ix, extra, {});
    M.flash = 0.5;
    yield { kind, sk, ix, M };
  }
}

test('모양(rigParts): 종류 × 상태 — 상자 ≤ 40 · 멀면 ≤ 3 · 발자국 안 · 높이 ≤ H_MAX · NaN 없음 · 색 키 있음', () => {
  const out = [], keys = new Set(Object.keys(RIG_HEX.dark));
  assert.deepEqual(Object.keys(RIG_HEX.dark).sort(), Object.keys(RIG_HEX.light).sort(), '테마 색 키 같음');
  for (const s of RIG_STATES) assert.ok(keys.has(s), '상태 색 키 ' + s);
  let cnt = 0;
  for (const { kind, sk, M } of allModels()) {
    assert.equal(M.kind, kind);
    if (kind !== 'oscillo' || sk !== 'stale') assert.equal(M.state, sk, `${kind} 상태 ${sk}`);
    for (const t of [0, 0.37, 1.1, 2.9, 7.3, 123.4]) {
      const n = rigParts(M, t, out, false, 0.7);
      assert.ok(n >= 4 && n <= LAB_PERF.RIG_BOXES, `${kind}/${sk} 상자 ${n}`);
      const half = kind === 'sequencer' ? 0.9 : LAB.RIG.SIZE / 2 + 1e-6;
      for (let i = 0; i < n; i++) {
        const p = out[i];
        for (const v of [p.x, p.y, p.z, p.sx, p.sy, p.sz, p.r, p.k]) assert.ok(Number.isFinite(v), `${kind}/${sk} NaN`);
        assert.ok(keys.has(p.c), `색 키 ${p.c}`);
        assert.ok(p.sx > 0 && p.sy > 0 && p.sz > 0, `${kind}/${sk} 크기 0 이하`);
        if (!p.r) { // 회전 없는 상자만 축 정렬 발자국 검사
          assert.ok(Math.abs(p.x) + p.sx / 2 <= half + 0.02, `${kind}/${sk} x 발자국 ${p.x} ${p.sx}`);
          assert.ok(Math.abs(p.z) + p.sz / 2 <= half + 0.02, `${kind}/${sk} z 발자국 ${p.z} ${p.sz}`);
        }
        const solid = !p.g && p.c !== 'smoke';
        if (solid) assert.ok(p.y + p.sy / 2 <= LAB.RIG.H_MAX + 1e-6, `${kind}/${sk} 높이 ${p.y + p.sy / 2}`);
        assert.ok(p.y - p.sy / 2 >= -1e-6, `${kind}/${sk} 바닥 아래`);
      }
      const nf = rigParts(M, t, out, true);
      assert.ok(nf >= 1 && nf <= LAB_PERF.RIG_BOXES_FAR, `${kind} LOD ${nf}`);
      cnt++;
    }
  }
  assert.ok(cnt > 1000);
  for (const k of RIG_KINDS) { assert.ok(RIG_HEIGHT[k] >= LAB.RIG.H_MIN && RIG_HEIGHT[k] <= LAB.RIG.H_MAX, k); assert.ok(RIG_GLYPH[k], k); }
});

test('모양: 상태가 빛으로 읽힘 — 실패 시험관 빨강·끝 주괴·대기 모래시계·재무장 렌즈 덮개·시퀀서 띠', () => {
  const out = [], now = 1e12;
  const has = (M, pred, t = 0.1) => { const n = rigParts(M, t, out); for (let i = 0; i < n; i++) if (pred(out[i])) return true; return false; };
  const run = { status: 'active', meta: {} };
  const T = rigModel(run, 'tests', now, { pass: 10, fail: 6, total: 16 }, null, {});
  assert.ok(has(T, (p) => p.g && p.c === 'fail'), '깨진 시험관 빨강');
  assert.ok(has(T, (p) => p.g && p.c === 'done'), '통과 시험관 초록');
  const R = rigModel({ status: 'done', endedAt: now - 2000, meta: {} }, 'reactor', now, null, null, {});
  assert.ok(has(R, (p) => p.c === 'ingot'), '끝 = 주괴 배출');
  const W = rigModel({ status: 'idle', meta: {} }, 'meter', now, null, null, {});
  assert.ok(has(W, (p) => p.g && p.c === 'wait'), '대기 = 파랑');
  const S = rigModel({ status: 'idle', meta: { rearmOf: 'm0' } }, 'scope', now, null, null, {});
  assert.ok(has(S, (p) => !p.g && p.c === 'panel' && Math.abs(p.z - 0.54) < 1e-6), '대기 = 렌즈 덮개');
  const Q = rigModel(run, 'sequencer', now, null, { band: [2, 4, 1], progress: 0.5 }, {});
  assert.ok(has(Q, (p) => p.g && p.c === 'fail') && has(Q, (p) => p.g && p.c === 'done'), '회차 띠 색');
  // 끝 표시등: 3초 고정 뒤 꺼짐
  const lampK = (age) => { const M = rigModel({ status: 'done', endedAt: now - age, meta: {} }, 'meter', now, null, null, {}); const n = rigParts(M, 0, out); let k = 0; for (let i = 0; i < n; i++) if (out[i].g && out[i].c === 'done') k = Math.max(k, out[i].k); return k; };
  assert.ok(lampK(1000) > 0.9 && lampK(RIGW.DONE_LIT_MS + 500) < 0.3);
  // 분주 로봇 팔 = 병렬도(최대 3)
  const arms = (par) => { const M = rigModel(run, 'dispenser', now, { par }, null, {}); const n = rigParts(M, 0, out); let c = 0; for (let i = 0; i < n; i++) if (out[i].c === 'metal' && Math.abs(out[i].y - 0.98) < 1e-6) c++; return c; };
  assert.equal(arms(1), 1); assert.equal(arms(2), 2); assert.equal(arms(8), RIGW.ARMS_MAX);
});

test('퇴장 승강판(rigLiftK): 0→1 단조, 배속 √ 로 빨라짐', () => {
  assert.equal(rigLiftK(null, 5), 0);
  assert.equal(rigLiftK(10, 10), 0);
  assert.ok(Math.abs(rigLiftK(10, 10 + RIGW.LIFT_S / 2) - 0.5) < 1e-9);
  assert.equal(rigLiftK(10, 10 + RIGW.LIFT_S + 0.1), 1);
  assert.ok(rigLiftK(10, 10.3, 16) > rigLiftK(10, 10.3, 1));
  assert.ok(Math.abs(rigLiftSec(4) - RIGW.LIFT_S / 2) < 1e-9);
  let prev = -1; for (let t = 0; t <= 1; t += 0.05) { const k = rigLiftK(0, t); assert.ok(k >= prev); prev = k; }
});

test('보조 선반(rigShelfSlots): 12칸 · 방사 통로 비움 · 고리 바깥·순환 통로 안 · 서로 안 겹침', () => {
  for (const rP of [7, 9, 14]) {
    const R = labRadii(rP), sh = rigShelfSlots(3, -2, rP), ring = rigSlots(3, -2, rP);
    assert.equal(sh.length, LAB.RIG.SHELF_MAX);
    assert.deepEqual(sh.map((s) => s.i), sh.map((_, k) => 1000 + k));
    for (const s of sh) {
      const r = Math.hypot(s.x - 3, s.z + 2);
      assert.ok(r > R.rRigOut && r < R.rWalkOut, `반지름 ${r}`);
      const halfGap = ((LAB.GANGWAY_WIDTH / 2 + 0.5) / r) * 180 / Math.PI;
      for (const g of LAB.GANGWAYS) assert.ok(Math.abs(dTheta(g, s.theta)) > halfGap, `통로 ${g} 와 ${s.theta}`);
      for (const q of ring) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) > (LAB.RIG.SIZE + LAB.RIG.SIZE * 0.6) / 2, '고리 칸과 겹침');
      for (const q of sh) if (q !== s) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) > LAB.RIG.SIZE * 0.6, '선반끼리 겹침');
      assert.equal(s.shelf, true); assert.equal(s.scale, 0.6);
    }
    assert.ok(Math.abs(dTheta(LAB.BRIDGE_THETA, sh[0].theta)) <= Math.abs(dTheta(LAB.BRIDGE_THETA, sh[sh.length - 1].theta)), '브리지 쪽 먼저');
  }
});

test('자리 배정: prev 유지(비워 둔 자리보다 우선) · 비워 둔 자리는 새 기자재에 안 줌 · 넘치면 Map 에 없음', () => {
  const slots = rigSlots(0, 0, 9);
  assert.ok(slots.length <= LAB_PERF.RIGS_RING);
  const rigs = [{ id: 'a', ownerTheta: slots[3].theta }, { id: 'b', ownerTheta: slots[3].theta }];
  const reserved = new Set([3]);
  const m = assignRigSlots(rigs, slots, null, reserved);
  assert.ok(m.get('a') !== 3 && m.get('b') !== 3, '비워 둔 자리 피함');
  const m2 = assignRigSlots(rigs, slots, new Map([['a', 3]]), reserved);
  assert.equal(m2.get('a'), 3, 'prev(재무장 이어받음)는 비워 둔 자리라도 지킴');
  const many = Array.from({ length: slots.length + 5 }, (_, i) => ({ id: 'r' + i, ownerTheta: 0 }));
  const m3 = assignRigSlots(many, slots);
  assert.equal(m3.size, slots.length);
  assert.equal(new Set(m3.values()).size, slots.length, '한 칸에 하나');
  // 넘친 것은 보조 선반으로
  const left = many.filter((g) => !m3.has(g.id));
  const m4 = assignRigSlots(left, rigShelfSlots(0, 0, 9));
  assert.equal(m4.size, left.length);
  assert.ok([...m4.values()].every((i) => i >= 1000));
});

test('성능: 고리 32 + 선반 12 모델·모양 갱신 < 1.0ms/프레임, 상자 합 ≤ 1,800', () => {
  const now = 2e12, out = [], models = [];
  for (let i = 0; i < LAB_PERF.RIGS_RING + LAB.RIG.SHELF_MAX; i++) {
    models.push({ node: { id: 'b' + i, status: i % 5 ? 'active' : 'idle', meta: { run: { kind: 'bg', since: now - 1e5, lastOut: now - 2e3, staleAfter: 6e5 } } }, kind: RIG_KINDS[i % RIG_KINDS.length], ix: i % 2 ? { pass: 3, fail: 1, total: 9, i: 2, n: 8, par: 3 } : null });
  }
  const M = {};
  let total = 0;
  const run = (t) => { total = 0; for (const r of models) { rigModel(r.node, r.kind, now, r.ix, null, M); total += rigParts(M, t, out, false, 0.3); } };
  for (let f = 0; f < 30; f++) run(f / 60); // 데우기
  const F = 200, t0 = performance.now();
  for (let f = 0; f < F; f++) run(f / 60);
  const ms = (performance.now() - t0) / F;
  assert.ok(total <= LAB_PERF.RIG_BOXES_TOTAL, `상자 ${total}`);
  assert.ok(ms < LAB_PERF.FRAME_MS, `프레임 ${ms.toFixed(3)}ms`);
});

test('i18n: 기자재 10종·상태 6종 키(en·ko)', () => {
  for (const lang of ['en', 'ko']) {
    for (const k of RIG_KINDS) assert.ok(MESSAGES[lang]['lab.rig.' + k], `${lang} lab.rig.${k}`);
    for (const s of RIG_STATES) assert.ok(MESSAGES[lang]['lab.state.' + s], `${lang} lab.state.${s}`);
    for (const k of ['lab.rig.rc', 'lab.rig.stale', 'lab.rig.shelfMore', 'lab.rig.lift']) assert.ok(MESSAGES[lang][k], `${lang} ${k}`);
  }
});
