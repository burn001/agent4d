// 서버 몰림 정리(coalesce) 핵심 불변식 — 정리한 이벤트를 웹 reducer 로 적용한 상태 == 원본 전부를 적용한 상태
// (노드 전체 필드: status·parentId·depth·label·meta·openTools·lastActivityAt …, seq). 시드 고정 무작위 이벤트 열 수백 개.
// 전제: 이벤트마다 ts 가 있다(Graph.emit·허브가 늘 붙임) — lastActivityAt 은 그 노드의 마지막 이벤트 ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesce } from '../../server/sse-out.mjs';
import { stateFromSnapshot, applyEvent } from '../replay/state.mjs';
import { batchItems, EVQ } from '../ev-queue.mjs';
import { readFileSync } from 'node:fs';

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const IDS = ['s:a', 'g:1', 'g:2', 'g:3', 'b:1', 'b:2', 'x:9'];
const CATS = ['read', 'edit', 'search', 'shell', 'web'];

function scenario(seed, { hub = false, n = 120 } = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const nodes = [];
  for (const id of IDS.slice(0, 2 + Math.floor(r() * 4))) {
    nodes.push({ id, kind: id === 's:a' ? 'main' : 'subagent', parentId: id === 's:a' ? null : 's:a', status: 'active', depth: id === 's:a' ? 0 : 1, label: id, lastActivityAt: 't0', meta: { a: 0 },
      openTools: r() < 0.3 ? [{ toolUseId: 'T' + Math.floor(r() * 6), tool: 'Read', cat: 'read', startedAt: 't0' }] : [] });
  }
  const snap = { root: hub ? null : 's:a', sessionId: 'a', seq: 100, nodes };
  const evs = [];
  let seq = 100;
  const ctx = hub ? { projectId: 'p', rootSessionId: 'a' } : {};
  for (let i = 0; i < n; i++) {
    const id = pick(IDS);
    const ts = 't' + String(1000 + i);
    const x = r();
    const base = { seq: ++seq, ts, nodeId: id, ...ctx };
    let e;
    if (x < 0.06) e = { ...base, type: 'node-add', node: { id, kind: 'subagent', parentId: 's:a', status: pick(['active', 'idle']), depth: 1, label: 'L' + i, lastActivityAt: ts, meta: { a: i, b: r() < 0.5 ? i : undefined }, openTools: r() < 0.2 ? [{ toolUseId: 'T' + Math.floor(r() * 6), tool: 'Edit', cat: 'edit', startedAt: ts }] : [] } };
    else if (x < 0.36) {
      const p = {};
      const y = r();
      if (y < 0.5) p.meta = { [pick(['a', 'b', 'c', 'run', 'ctx'])]: r() < 0.1 ? null : Math.floor(r() * 50) };
      if (y > 0.4 && y < 0.6) p.label = 'N' + i;
      if (y > 0.55 && y < 0.75) p.status = pick(['active', 'idle', 'done', 'error']);
      if (y > 0.7 && y < 0.8) { p.parentId = pick(IDS); p.depth = Math.floor(r() * 3); }
      if (y > 0.8) p.endedAt = ts;
      if (r() < 0.3) p.meta = { ...(p.meta || {}), [pick(['a', 'z'])]: i };
      e = { ...base, type: 'node-update', patch: p, ...(r() < 0.07 ? { ix: { v: 1, cat: 'user', op: 'reply' } } : {}) };
    } else if (x < 0.56) e = { ...base, type: 'tool-start', toolUseId: 'T' + Math.floor(r() * 8), tool: 'Read', cat: pick(CATS), text: 'f' + i, ...(r() < 0.2 ? { art: [{ id: 'f' + i }] } : {}), ...(r() < 0.05 ? { ix: { v: 1, cat: 'tool' } } : {}), ...(r() < 0.2 ? { panel: { mode: 'tool', lines: ['l' + i] } } : {}) };
    else if (x < 0.74) e = { ...base, type: 'tool-end', toolUseId: 'T' + Math.floor(r() * 8), tool: 'Read', cat: pick(CATS), ok: r() > 0.15, ...(r() < 0.15 ? { art: [{ id: 'g' + i }] } : {}) };
    else if (x < 0.82) e = { ...base, type: 'output', text: `line ${i}\n`, ...(r() < 0.5 ? { toolUseId: 'T' + Math.floor(r() * 3) } : {}), ...(r() < 0.3 ? { fg: true } : {}), ...(r() < 0.05 ? { ix: { v: 1 } } : {}) };
    else if (x < 0.88) e = { ...base, type: 'text', role: pick(['assistant', 'system']), text: 'say ' + i };
    else if (x < 0.92) e = { ...base, type: 'thinking', chars: Math.floor(r() * 100) };
    else if (x < 0.95) e = { ...base, type: pick(['user', 'result', 'session-msg', 'conflict', 'watch']), text: 'u' + i };
    else if (hub && x < 0.985) { const ids = [id, ...IDS.filter(() => r() < 0.2)]; e = { ...base, type: 'node-remove', subtree: true, ids: [...new Set(ids)] }; }
    else e = { ...base, type: 'node-update', patch: { meta: { tick: i } } };
    evs.push(e);
  }
  return { snap, evs };
}

/** 원본 이벤트 열을 창 여러 개로 잘라(서버가 창마다 정리) 정리 결과를 이어 붙인다 */
function windows(evs, r) {
  const out = [];
  let i = 0;
  while (i < evs.length) {
    const len = 1 + Math.floor(r() * (r() < 0.3 ? 8 : 80));
    out.push(...coalesce(evs.slice(i, i + len)));
    i += len;
  }
  return out;
}

const run = (snap, evs) => { const st = stateFromSnapshot(structuredClone(snap)); for (const e of evs) applyEvent(st, structuredClone(e)); return st; };
const plain = (st, { root = true } = {}) => ({ seq: st.seq, ...(root ? { root: st.root } : {}), nodes: [...st.nodes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, n]) => [id, JSON.parse(JSON.stringify(n))]) });

test('속성: 정리 결과 적용 상태 == 원본 전부 적용 상태(단일 세션 300열 · 전체 보기 300열, 시드 고정)', () => {
  let totalIn = 0, totalOut = 0;
  for (const hub of [false, true]) {
    for (let s = 1; s <= 300; s++) {
      const seed = s * 7919 + (hub ? 1 : 0);
      const { snap, evs } = scenario(seed, { hub, n: 40 + (s % 7) * 40 });
      const before = JSON.stringify(evs);
      const want = run(snap, evs);
      const r = rng(seed ^ 0xabcdef);
      const got = windows(evs, r);
      assert.equal(JSON.stringify(evs), before, '원본 이벤트를 고치지 않음');
      // seq 단조 증가 · 각 seq 는 원본에 있던 것
      const seqs = new Set(evs.map((e) => e.seq));
      for (let i = 0; i < got.length; i++) {
        assert.ok(seqs.has(got[i].seq), `seed ${seed}: seq ${got[i].seq} 은 원본 것`);
        if (i) assert.ok(got[i].seq > got[i - 1].seq, `seed ${seed}: seq 오름차순`);
      }
      assert.deepEqual(plain(run(snap, got), { root: !hub }), plain(want, { root: !hub }), `seed ${seed} hub=${hub}`);
      // 통째로 한 창
      assert.deepEqual(plain(run(snap, coalesce(evs)), { root: !hub }), plain(want, { root: !hub }), `seed ${seed} hub=${hub} 한 창`);
      // 남기는 도구 0개(모두 요약)도 같은 상태
      assert.deepEqual(plain(run(snap, coalesce(evs, { toolKeep: 0 })), { root: !hub }), plain(want, { root: !hub }), `seed ${seed} toolKeep 0`);
      totalIn += evs.length; totalOut += coalesce(evs).length;
    }
  }
  assert.ok(totalOut < totalIn * 0.75, `한 창 정리로 25% 넘게 줄어듦(${totalOut}/${totalIn})`);
});

test('중요 이벤트(user·result·conflict·session-msg·watch·ix)는 빠짐없이 순서대로', () => {
  for (let s = 1; s <= 100; s++) {
    const { evs } = scenario(s * 31, { hub: s % 2 === 0 });
    const imp = (e) => ['user', 'result', 'conflict', 'session-msg', 'watch'].includes(e.type) || e.ix != null;
    const a = evs.filter(imp).map((e) => e.seq), b = coalesce(evs).filter(imp).map((e) => e.seq);
    assert.deepEqual(b, a, `seed ${s}`);
  }
});

test('웹 묶음 수신: 뒤쪽 BATCH_FX 건만 연출, 앞은 quiet · app.js 가 batch·tool-summary·coalesced 를 처리', () => {
  const evs = Array.from({ length: 100 }, (_, i) => ({ seq: i + 1, type: 'text' }));
  const it = batchItems({ events: evs });
  assert.equal(it.length, 100);
  assert.equal(it.filter((x) => x.quiet).length, 100 - EVQ.BATCH_FX);
  assert.ok(!it.at(-1).quiet && it[0].quiet);
  assert.deepEqual(batchItems({ events: evs.slice(0, 3) }).map((x) => !!x.quiet), [false, false, false]);
  assert.deepEqual(batchItems(null), []);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /addEventListener\('batch'/);
  assert.match(app, /q\.batch = '1'/);
  assert.match(app, /case 'tool-summary'/);
  assert.match(app, /quiet: quiet \|\| dense/);
  const panel = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');
  assert.match(panel, /case 'tool-summary'/);
});
