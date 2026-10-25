// node --test "web/test/sfx.test.mjs"   (소리 표 전 행, 속도별 솎아내기, 버킷·최소 간격, scaleNotes 화음표)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventToSound, RateLimiter, scaleNotes, chordAtBar, noteFor, SOUNDS, CHORD_NOTES, REGISTERS, Sfx, hashStr } from '../sfx.mjs';

const N = (kind, id = kind === 'main' ? 's:m' : 'a:' + kind) => ({ id, kind });

test('§16.2 이벤트 → 소리 표 전 행', () => {
  const sub = N('subagent');
  const rows = [
    [{ type: 'node-update', nodeId: 'a:x', patch: { status: 'error' } }, sub, 'error', 0],
    [{ type: 'tool-end', nodeId: 'a:x', ok: false, cat: 'shell' }, sub, 'error', 0],
    [{ type: 'result', nodeId: 'a:x', ok: false }, sub, 'error', 0],
    [{ type: 'user', nodeId: 's:m', origin: 'human' }, N('main'), 'user', 0],
    [{ type: 'node-add', nodeId: 'a:1', node: { id: 'a:1', kind: 'subagent' } }, null, 'spawn', 1],
    [{ type: 'node-add', nodeId: 'a:2', node: { id: 'a:2', kind: 'workflow-agent' } }, null, 'spawn-soft', 1],
    [{ type: 'node-add', nodeId: 'w:1', node: { id: 'w:1', kind: 'workflow' } }, null, 'workflow', 1],
    [{ type: 'node-add', nodeId: 's:c', node: { id: 's:c', kind: 'claude-p' } }, null, 'spawn-p', 1],
    [{ type: 'node-add', nodeId: 'b:1', node: { id: 'b:1', kind: 'bash-bg' } }, null, 'machine-on', 2],
    [{ type: 'node-add', nodeId: 'm:1', node: { id: 'm:1', kind: 'monitor' } }, null, 'machine-on', 2],
    [{ type: 'node-update', nodeId: 'a:x', patch: { status: 'done' } }, sub, 'done', 1],
    [{ type: 'node-update', nodeId: 'a:y', patch: { status: 'done' } }, N('workflow-agent'), 'done', 1],
    [{ type: 'node-update', nodeId: 's:c', patch: { status: 'done' } }, N('claude-p'), 'done', 1],
    [{ type: 'node-update', nodeId: 'w:1', patch: { status: 'done' } }, N('workflow'), 'done', 1],
    [{ type: 'result', nodeId: 'a:x', ok: true }, sub, 'done', 1],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'skill' }, sub, 'skill', 1],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'shell' }, sub, 'shell', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'read' }, sub, 'page', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'write' }, sub, 'type', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'edit' }, sub, 'type2', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'search' }, sub, 'scan', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'agent' }, sub, 'whoosh', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'workflow' }, sub, 'ring', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'web' }, sub, 'ping', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'monitor' }, sub, 'sonar', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'mcp' }, sub, 'fm2', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'artifact' }, sub, 'pluck', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'notify' }, sub, 'chime', 2],
    [{ type: 'tool-start', nodeId: 'a:x', cat: 'other' }, sub, 'tick', 2],
    [{ type: 'tool-end', nodeId: 'a:x', ok: true, cat: 'read' }, sub, 'end-tick', 3],
    [{ type: 'output', nodeId: 'b:1' }, N('bash-bg', 'b:1'), 'blip', 3],
  ];
  for (const [ev, node, name, p] of rows) {
    const s = eventToSound(ev, node);
    assert.ok(s, `${JSON.stringify(ev)} → ${name}`);
    assert.equal(s.name, name, JSON.stringify(ev));
    assert.equal(s.priority, p, JSON.stringify(ev));
    assert.ok(SOUNDS[s.name], `SOUNDS.${s.name}`);
    assert.ok(s.pan >= -0.4 && s.pan <= 0.4);
  }
  // 소리 없음
  for (const ev of [
    { type: 'text', nodeId: 's:m' }, { type: 'thinking', nodeId: 's:m' }, { type: 'user', nodeId: 's:m', origin: 'task-notification' },
    { type: 'user', nodeId: 's:m', origin: 'system' }, { type: 'node-add', nodeId: 's:m', node: { id: 's:m', kind: 'main' } },
    { type: 'node-update', nodeId: 's:m', patch: { status: 'idle' } }, { type: 'node-update', nodeId: 'b:1', patch: { status: 'done' } },
    { type: 'node-update', nodeId: 's:m', patch: { status: 'done' } }, { type: 'unknown' }, null,
  ]) assert.equal(eventToSound(ev, ev && ev.nodeId === 'b:1' ? N('bash-bg', 'b:1') : N('main')), null, JSON.stringify(ev));
  // main 은 가운데, 같은 노드는 같은 음 높이·pan
  assert.equal(eventToSound({ type: 'tool-start', nodeId: 's:m', cat: 'read' }, N('main')).pan, 0);
  const a = eventToSound({ type: 'tool-start', nodeId: 'a:abc', cat: 'read' }, sub);
  const b = eventToSound({ type: 'tool-start', nodeId: 'a:abc', cat: 'shell' }, sub);
  assert.equal(a.pitchIndex, b.pitchIndex); assert.equal(a.pan, b.pan);
});

test('SOUNDS: 길이 제한(≤400ms, done ≤900ms)', () => {
  for (const [name, s] of Object.entries(SOUNDS)) {
    assert.ok(s.dur <= (name === 'done' ? 0.9 : 0.4), `${name} ${s.dur}`);
    assert.ok(REGISTERS[s.register], name);
  }
});

test('scaleNotes: 음악 꺼짐 = D 단조 5음, 켜짐 = 화음 ∩ D 5음 (마디 0·30·60·90·119)', () => {
  assert.deepEqual(scaleNotes(null), [62, 65, 67, 69, 72]); // D4 F4 G4 A4 C5
  const pc = (arr) => [...new Set(arr.map((m) => m % 12))].sort((x, y) => x - y);
  const penta = [0, 2, 5, 7, 9];
  const expectChord = { 0: 'Dm9', 30: 'Dm9', 60: 'Gm9', 90: 'Dm9', 119: 'Dm9' };
  for (const [bar, name] of Object.entries(expectChord)) {
    assert.equal(chordAtBar(Number(bar)), name, `bar ${bar}`);
    const notes = scaleNotes(Number(bar) * 2.5 + 0.1);
    let want = pc(CHORD_NOTES[name]).filter((p) => penta.includes(p));
    if (want.length < 2) want = pc(CHORD_NOTES[name]);
    assert.deepEqual(pc(notes), want, `bar ${bar}`);
  }
  // 그 밖 화음표 구간(compose.py build_chords)
  assert.equal(chordAtBar(2), 'Bbmaj9'); assert.equal(chordAtBar(4), 'Fmaj7'); assert.equal(chordAtBar(6), 'C69'); assert.equal(chordAtBar(8), 'Dm9');
  assert.equal(chordAtBar(62), 'Ebmaj7#11'); assert.equal(chordAtBar(66), 'A7'); assert.equal(chordAtBar(88), 'A7'); assert.equal(chordAtBar(89), 'A7');
  assert.equal(chordAtBar(94), 'Gm9'); assert.equal(chordAtBar(106), 'Bbmaj9'); assert.equal(chordAtBar(108), 'Gm9'); assert.equal(chordAtBar(110), 'Dm9');
  assert.equal(chordAtBar(120), 'Dm9'); // 루프
  // Ebmaj7#11 ∩ D5 = G D (2음) — 2음 이상이면 교집합
  assert.deepEqual(pc(scaleNotes(62 * 2.5)), [2, 7]);
  // 음역: noteFor 는 음역 안 + 음계 안
  for (const reg of Object.keys(REGISTERS)) for (let i = 0; i < 12; i++) {
    const m = noteFor(scaleNotes(null), reg, i);
    assert.ok(m >= REGISTERS[reg][0] && m <= REGISTERS[reg][1]);
    assert.ok(penta.includes(m % 12));
  }
});

function burst(lim, items, speed, { stepMs = 10, start = 10000 } = {}) {
  const ok = [];
  let t = start;
  for (const it of items) { if (lim.allow(it, t, speed)) ok.push({ t, ...it }); t += stepMs; }
  return ok;
}
const S = (name, priority, key = 'a:1', cat) => ({ name, priority, key, cat });

test('RateLimiter: 버킷 초당 8·버스트 4, 같은 이름 최소 90ms, P0 예외', () => {
  const lim = new RateLimiter();
  // 서로 다른 노드·이름 20개를 1ms 간격 → 버스트 4
  const names = ['shell', 'page', 'type', 'scan', 'whoosh', 'ring', 'ping', 'sonar', 'fm2', 'pluck'];
  let ok = burst(lim, names.map((n, i) => S(n, 2, 'a:' + i)), 1, { stepMs: 1 });
  assert.equal(ok.length, 4);
  // 이후 10초 동안 50ms 마다 서로 다른 소리 → 초당 ≤ 8(+버스트)
  const lim2 = new RateLimiter();
  const items = []; for (let i = 0; i < 200; i++) items.push(S(names[i % names.length], 2, 'a:' + (i % 37)));
  ok = burst(lim2, items, 1, { stepMs: 50 });
  assert.ok(ok.length <= 8 * 10 + 4 && ok.length >= 70, `ok ${ok.length}`);
  // 같은 이름 90ms 안 금지
  const lim3 = new RateLimiter();
  assert.equal(lim3.allow(S('shell', 2, 'a:1'), 0, 1), true);
  assert.equal(lim3.allow(S('shell', 2, 'a:2'), 50, 1), false);
  assert.equal(lim3.allow(S('shell', 2, 'a:3'), 95, 1), true);
  // P0 는 버킷이 비어도 들어감, 같은 이름 150ms 안 중복만 막음
  const lim4 = new RateLimiter();
  burst(lim4, names.map((n, i) => S(n, 2, 'a:' + i)), 1, { stepMs: 1, start: 0 });
  assert.equal(lim4.allow(S('user', 0, 's:m'), 20, 1), true);
  assert.equal(lim4.allow(S('user', 0, 's:m2'), 100, 1), false);
  assert.equal(lim4.allow(S('error', 0, 'a:9'), 110, 1), true);
  assert.equal(lim4.allow(S('user', 0, 's:m3'), 200, 1), true);
  // 같은 노드·같은 소리 250ms 안 합침, blip 노드당 2초 1회, done+result 1.2초 합침
  const lim5 = new RateLimiter();
  assert.equal(lim5.allow(S('page', 2, 'a:1', 'read'), 0, 1), true);
  assert.equal(lim5.allow(S('page', 2, 'a:1', 'read'), 200, 1), false);
  assert.equal(lim5.allow(S('page', 2, 'a:1', 'read'), 300, 1), true);
  assert.equal(lim5.allow(S('blip', 3, 'b:1'), 1000, 1), true);
  assert.equal(lim5.allow(S('blip', 3, 'b:1'), 2500, 1), false);
  assert.equal(lim5.allow(S('blip', 3, 'b:2'), 2600, 1), true);
  assert.equal(lim5.allow(S('blip', 3, 'b:1'), 3100, 1), true);
  assert.equal(lim5.allow(S('done', 1, 'a:5'), 4000, 1), true);
  assert.equal(lim5.allow(S('done', 1, 'a:5'), 4500, 1), false);
});

/** 재생 속도 s 에서 무작위로 섞인 이벤트 흐름(초당 200건, 20초) */
function stream(seed = 1) {
  const pool = [S('shell', 2), S('page', 2), S('type', 2), S('scan', 2), S('end-tick', 3), S('blip', 3), S('spawn', 1), S('done', 1), S('skill', 1), S('error', 0), S('user', 0), S('spawn-soft', 1)];
  let x = seed; const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const out = [];
  for (let i = 0; i < 4000; i++) {
    const p = pool[Math.floor(r() * pool.length)];
    const pr = p.priority === 0 ? (r() < 0.1 ? p : S('page', 2)) : p; // P0 는 드물게
    out.push({ ...pr, key: 'a:' + Math.floor(r() * 30), cat: pr.name });
  }
  return out;
}
const perSecondMax = (ok) => { const m = new Map(); for (const o of ok) { const s = Math.floor(o.t / 1000); m.set(s, (m.get(s) || 0) + 1); } return Math.max(0, ...m.values()); };

test('속도별 솎아내기: 4×·8×·16×·32×', () => {
  const st = stream();
  const run = (sp) => burst(new RateLimiter(), st, sp, { stepMs: 5, start: 0 });
  const r1 = run(1), r4 = run(4), r8 = run(8), r16 = run(16), r32 = run(32);
  assert.ok(r1.some((o) => o.priority === 3), '1× 는 P3 도 남(버킷 안)');
  assert.ok(!r4.some((o) => o.priority === 3), '4× P3 버림');
  assert.ok(!r8.some((o) => o.priority === 3));
  // 8×: P2 는 300ms 창마다 하나
  const w8 = new Map(); for (const o of r8.filter((o) => o.priority === 2)) { const w = Math.floor(o.t / 300); w8.set(w, (w8.get(w) || 0) + 1); }
  assert.ok([...w8.values()].every((n) => n === 1), '8× P2 창당 1');
  // 16×: P2 버림, P1 은 500ms 창마다 하나
  assert.ok(!r16.some((o) => o.priority >= 2));
  const w16 = new Map(); for (const o of r16.filter((o) => o.priority === 1)) { const w = Math.floor(o.t / 500); w16.set(w, (w16.get(w) || 0) + 1); }
  assert.ok([...w16.values()].every((n) => n === 1), '16× P1 창당 1');
  assert.ok(r16.some((o) => o.priority === 0));
  // 32×: P0 과 spawn 만, 초당 ≤ 4
  assert.ok(r32.every((o) => o.priority === 0 || /^spawn/.test(o.name)));
  assert.ok(perSecondMax(r32) <= 4, `32× 초당 ${perSecondMax(r32)}`);
  assert.ok(r32.length > 0);
  // 빠를수록 적게
  assert.ok(r1.length >= r4.length && r4.length >= r8.length && r8.length >= r16.length && r16.length >= r32.length, [r1, r4, r8, r16, r32].map((r) => r.length).join(','));
});

// ───────── Sfx: 가짜 AudioContext 로 voice 상한·quiet 무음·볼륨 분리 ─────────
function fakeAudio() {
  const made = { gains: [], oscs: 0, ctx: null };
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(t) { this.value = t; }, cancelScheduledValues() {} });
  const nodeBase = () => ({ connect() {}, disconnect() {} });
  class Ctx {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = nodeBase(); made.ctx = this; }
    createGain() { const g = { ...nodeBase(), gain: param(1) }; made.gains.push(g); return g; }
    createOscillator() { made.oscs++; return { ...nodeBase(), type: 'sine', frequency: param(440), detune: param(0), start() {}, stop() {} }; }
    createBiquadFilter() { return { ...nodeBase(), type: 'lowpass', frequency: param(1000), Q: param(1) }; }
    createBuffer(c, n) { const d = new Float32Array(n); return { getChannelData: () => d }; }
    createBufferSource() { return { ...nodeBase(), buffer: null, start() {}, stop() {} }; }
    createStereoPanner() { return { ...nodeBase(), pan: param(0) }; }
    createDynamicsCompressor() { return { ...nodeBase(), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }; }
    resume() { return Promise.resolve(); }
    close() {}
  }
  return { Ctx, made };
}

test('Sfx: 기본 꺼짐, quiet 무음, voice ≤ 6(P0 은 끼어듦), 볼륨·저장 키 분리, 음악 켜지면 −3dB', () => {
  const { Ctx, made } = fakeAudio();
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let music = null;
  const sfx = new Sfx({ AudioCtx: Ctx, storage, getMusicTime: () => music });
  assert.equal(sfx.enabled, false);
  assert.equal(sfx.volume, 0.5);
  assert.equal(sfx.onEvent({ type: 'user', nodeId: 's:m', origin: 'human' }, { node: { kind: 'main' } }), false, '꺼져 있으면 무음');
  assert.equal(made.ctx, null, '켜기 전에는 AudioContext 를 만들지 않음');
  sfx.setEnabled(true);
  assert.ok(made.ctx);
  assert.equal(sfx.onEvent({ type: 'user', nodeId: 's:m', origin: 'human' }, { node: { kind: 'main' }, quiet: true }), false, 'quiet 무음');
  // 같은 순간 10개 → voice 최대 6
  for (let i = 0; i < 10; i++) sfx.play(['shell', 'page', 'type', 'scan', 'ring', 'ping', 'sonar', 'fm2', 'pluck', 'chime'][i], { priority: 2 });
  assert.equal(sfx.voices.filter((v) => v.end > 0).length, 6);
  assert.ok(sfx.stats.stolen >= 4 || sfx.stats.dropped >= 1);
  // P3 은 꽉 찼을 때 P2 를 밀어내지 못함
  const before = sfx.stats.played;
  assert.equal(sfx.play('end-tick', { priority: 3 }), false);
  assert.equal(sfx.stats.played, before);
  // P0 은 언제나 들어감
  assert.equal(sfx.play('error', { priority: 0 }), true);
  assert.equal(sfx.voices.filter((v) => v.end > 0).length, 6);
  // 볼륨: 버스 게인 = volume × 0.6, 음악 켜지면 ×0.708
  sfx.setVolume(1);
  assert.ok(Math.abs(sfx._bus.bus.gain.value - 0.6) < 1e-9);
  music = 12.3; sfx.setVolume(1);
  assert.ok(Math.abs(sfx._bus.bus.gain.value - 0.6 * 0.708) < 1e-9);
  // 저장: ccviz.sfx 만 씀(배경음악 ccviz.music 과 분리)
  assert.deepEqual(JSON.parse(store.get('ccviz.sfx')), { on: true, volume: 1 });
  assert.equal(store.has('ccviz.music'), false);
  // 다시 만들면 볼륨 복원, 켜짐은 wantOn(사용자 동작 기다림)
  const sfx2 = new Sfx({ AudioCtx: Ctx, storage });
  assert.equal(sfx2.volume, 1); assert.equal(sfx2.wantOn, true); assert.equal(sfx2.enabled, false);
  sfx.setEnabled(false);
  assert.equal(sfx.onEvent({ type: 'user', nodeId: 's:m', origin: 'human' }, {}), false);
  sfx.dispose();
});

test('Sfx.onEvent: 32× 재생에서 초당 ≤ 4, 라이브(replay:false)는 속도 무시', () => {
  const { Ctx } = fakeAudio();
  const sfx = new Sfx({ AudioCtx: Ctx, storage: null });
  sfx.setEnabled(true);
  const realNow = performance.now.bind(performance);
  let t = 0;
  performance.now = () => t;
  try {
    let n = 0;
    for (let i = 0; i < 2000; i++) { // 2초, 1ms 간격
      t = i;
      const kinds = ['subagent', 'workflow-agent', 'claude-p'];
      const ev = i % 3 === 0 ? { type: 'node-add', nodeId: 'a:' + i, node: { id: 'a:' + i, kind: kinds[i % 3] } } : { type: 'tool-start', nodeId: 'a:' + (i % 9), cat: 'read' };
      if (sfx.onEvent(ev, { node: { kind: 'subagent' }, speed: 32, replay: true })) n++;
    }
    assert.ok(n <= 8 && n >= 2, `2초 동안 ${n}`);
    // 라이브(replay:false)는 speed 인자를 무시한다 → 32 를 넘겨도 tool-start(P2) 가 울린다
    const live = new Sfx({ AudioCtx: Ctx, storage: null }); live.setEnabled(true);
    t = 100000;
    assert.equal(live.onEvent({ type: 'tool-start', nodeId: 'a:z', cat: 'read' }, { node: { kind: 'subagent' }, speed: 32, replay: false }), true);
    t = 100500;
    assert.equal(sfx.onEvent({ type: 'tool-start', nodeId: 'a:z', cat: 'read' }, { node: { kind: 'subagent' }, speed: 32, replay: true }), false);
    live.dispose();
  } finally { performance.now = realNow; }
  assert.ok(hashStr('a') !== hashStr('b'));
  sfx.dispose();
});
