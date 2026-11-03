// node --test "web/test/lab-audio.test.mjs"   복셀 연구소 음악·효과음(audio 담당): 연구소 효과음 합성 규격 · 덮어쓰기 규칙 · 제한 · 배경음악 풀
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SOUNDS, REGISTERS, synth, scaleNotes, RateLimiter, Sfx, MAX_VOICES, eventToSound } from '../sfx.mjs';
import {
  LAB_SFX, LAB_SFX_NAMES, LAB_SFX_PRI, LAB_SFX_GAP_MS, LAB_SFX_GAIN, LAB_BGM_FALLBACK, LAB_TRACKS,
  labSoundFor, labEventSound, labSpeedOk, labPoolView, LabSoundGate,
} from '../lab/lab-audio.mjs';
import { parseManifest, VIEWS } from '../bgm-core.mjs';
import { viewCandidates, pickForLevel } from '../bgm-auto.mjs';

// ───────── 기록하는 가짜 AudioContext(OfflineAudioContext 대신 — 노드·예약을 모두 기록해 규격을 검사) ─────────
function recCtx() {
  const rec = { oscs: [], srcs: [], gains: [], filters: [] };
  const param = (v = 0) => {
    const p = { value: v, ev: [] };
    for (const k of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) p[k] = (val, t) => { p.ev.push([k, val, t]); return p; };
    p.cancelScheduledValues = () => p;
    return p;
  };
  const base = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    currentTime: 0, sampleRate: 8000, state: 'running', destination: base(),
    createGain() { const g = { ...base(), gain: param(1) }; rec.gains.push(g); return g; },
    createOscillator() { const o = { ...base(), type: 'sine', frequency: param(440), detune: param(0), start(t) { o.t0 = t; }, stop(t) { o.t1 = t; } }; rec.oscs.push(o); return o; },
    createBiquadFilter() { const f = { ...base(), type: 'lowpass', frequency: param(1000), Q: param(1) }; rec.filters.push(f); return f; },
    createBuffer(c, n) { const d = new Float32Array(n); return { getChannelData: () => d }; },
    createBufferSource() { const s = { ...base(), buffer: null, start(t) { s.t0 = t; }, stop(t) { s.t1 = t; } }; rec.srcs.push(s); return s; },
    createStereoPanner() { return { ...base(), pan: param(0) }; },
    createDynamicsCompressor() { return { ...base(), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }; },
    resume() { return Promise.resolve(); }, close() {},
  };
  return { ctx, rec };
}

test('연구소 효과음 12종: 이름 lab-*, sfx.mjs SOUNDS 에 같은 이름 · 길이 ≤ 0.4초 · 음역 · 우선순위 0～3', () => {
  assert.equal(LAB_SFX_NAMES.length, 12);
  for (const n of LAB_SFX_NAMES) {
    assert.match(n, /^lab-/);
    assert.ok(SOUNDS[n], `SOUNDS.${n}`);
    assert.ok(SOUNDS[n].dur > 0 && SOUNDS[n].dur <= 0.4, `${n} ${SOUNDS[n].dur}`);
    assert.ok(REGISTERS[SOUNDS[n].register], `${n} 음역`);
    assert.ok(SOUNDS[n].desc && LAB_SFX[n], `${n} 설명`);
    assert.ok([0, 1, 2, 3].includes(LAB_SFX_PRI[n]), `${n} 우선순위`);
  }
  assert.equal(LAB_SFX_GAP_MS, 250);
  for (const g of Object.values(LAB_SFX_GAIN)) assert.ok(g > 0 && g <= 1);
});

test('합성(기록 컨텍스트): 소리마다 음원 ≥ 1, 끝 시각 = t0 + dur, 모든 음원이 그 안에서 멈춤, 어택 ≥ 5ms, 게인·주파수 범위', () => {
  for (const notes of [scaleNotes(null), scaleNotes(77.3), scaleNotes(190)]) {
    for (const n of LAB_SFX_NAMES) for (const pitchIndex of [0, 3, 6]) {
      const { ctx, rec } = recCtx();
      const t0 = 1.0;
      const end = synth(ctx, ctx.destination, n, t0, { notes, pitchIndex, gain: 1 });
      const dur = SOUNDS[n].dur;
      assert.ok(Math.abs(end - (t0 + dur)) < 1e-9, `${n} 끝 ${end - t0} ≠ ${dur}`);
      const srcs = [...rec.oscs, ...rec.srcs];
      assert.ok(srcs.length >= 1, `${n} 음원`);
      for (const s of srcs) {
        assert.ok(s.t0 >= t0 - 1e-9, `${n} 시작`);
        assert.ok(s.t1 <= end + 0.03 + 1e-9, `${n} 멈춤 ${s.t1 - t0}`);
      }
      for (const o of rec.oscs) for (const [, f] of o.frequency.ev) assert.ok(f >= 20 && f <= 16000, `${n} 주파수 ${f}`);
      for (const f of rec.filters) for (const [, hz] of f.frequency.ev) assert.ok(hz >= 20 && hz <= 16000, `${n} 필터 ${hz}`);
      // 엔벨로프 게인: 0 에서 시작해 어택 ≥ 5ms 로 정점, 정점 ≤ 0.35
      const envs = rec.gains.filter((g) => g.gain.ev.length >= 3);
      assert.ok(envs.length >= 1, `${n} 엔벨로프`);
      for (const g of envs) {
        const [first, ramp] = g.gain.ev;
        assert.equal(first[0], 'setValueAtTime'); assert.equal(first[1], 0);
        assert.equal(ramp[0], 'linearRampToValueAtTime');
        assert.ok(ramp[2] - first[2] >= 0.005 - 1e-9, `${n} 어택 ${ramp[2] - first[2]}`);
        assert.ok(ramp[1] > 0 && ramp[1] <= 0.35, `${n} 정점 ${ramp[1]}`);
        assert.equal(g.gain.ev[g.gain.ev.length - 1][1], 0, `${n} 끝은 0`);
      }
    }
  }
});

test('labSoundFor: 연구소가 아니면 null, 장면·기자재 상태·이벤트별 덮어쓰기, 나머지는 기존 소리(null)', () => {
  const L = { view: 'lab' };
  assert.equal(labSoundFor({ type: 'node-add', node: { kind: 'bash-bg' } }, { view: 'voxel' }), null);
  assert.equal(labSoundFor({ type: 'node-add', node: { kind: 'bash-bg' } }), null);
  assert.equal(labSoundFor(null, { view: 'voxel', act: 'build' }), null);
  // 장면 → 연구소 은유
  const acts = { build: 'lab-print', edit: 'lab-edit', shatter: 'lab-shatter', launch: 'lab-absorb', radar: 'lab-radar', wave: 'lab-wave', alarm: 'lab-alarm', flash: null, read: null };
  for (const [a, want] of Object.entries(acts)) assert.equal(labSoundFor(null, { ...L, act: a }), want, a);
  // 기자재 상태 변화
  const st = { run: 'lab-rig-on', done: 'lab-rig-done', fail: 'lab-rig-fail', stale: 'lab-rig-stale', wait: null, stop: null };
  for (const [s, want] of Object.entries(st)) assert.equal(labSoundFor({ type: 'rig-state' }, { ...L, rigState: s, rigKind: 'reactor' }), want, s);
  assert.equal(labSoundFor({ type: 'rig-lift' }, L), 'lab-lift');
  // 앱 이벤트
  assert.equal(labSoundFor({ type: 'node-add', node: { kind: 'bash-bg' } }, L), 'lab-rig-on');
  assert.equal(labSoundFor({ type: 'node-add', node: { kind: 'monitor' } }, L), 'lab-rig-on');
  assert.equal(labSoundFor({ type: 'node-add', node: { kind: 'subagent' } }, L), null);
  assert.equal(labSoundFor({ type: 'node-update', patch: { status: 'done' }, node: { kind: 'bash-bg' } }, L), 'lab-rig-done');
  assert.equal(labSoundFor({ type: 'node-update', patch: { status: 'error' } }, { ...L, nodeKind: 'monitor' }), 'lab-rig-fail');
  assert.equal(labSoundFor({ type: 'node-update', patch: { status: 'error' }, node: { kind: 'subagent' } }, L), null, '서브에이전트 오류는 기존 오류음');
  assert.equal(labSoundFor({ type: 'node-update', patch: { status: 'stopped' }, node: { kind: 'bash-bg' } }, L), null, '중지는 기존 stop');
  assert.equal(labSoundFor({ type: 'tool-start', cat: 'search', tool: 'Grep' }, L), 'lab-radar');
  assert.equal(labSoundFor({ type: 'tool-start', cat: 'search', tool: 'WebSearch' }, L), null);
  assert.equal(labSoundFor({ type: 'tool-start', cat: 'read' }, L), null);
  const push = { type: 'tool-end', ix: { cat: 'github', op: 'push', phase: 'end', ok: true } };
  assert.equal(labSoundFor(push, L), 'lab-absorb');
  assert.equal(labSoundFor({ ...push, ix: { ...push.ix, upToDate: true } }, L), null);
  assert.equal(labSoundFor({ ...push, ix: { ...push.ix, ok: false } }, L), null);
  assert.equal(labSoundFor({ type: 'tool-end', ix: { cat: 'tests', phase: 'end', pass: 3 } }, L), null);
  for (const n of Object.values(acts).concat(Object.values(st))) if (n) assert.ok(LAB_SFX[n], n);
});

test('labEventSound: 기존 소리 모양(우선순위·음높이·팬·키) 유지, 이름만 연구소 소리 · 연구소 아니면 eventToSound 그대로', () => {
  const ev = { type: 'node-add', nodeId: 'b:1', node: { id: 'b:1', kind: 'bash-bg' } };
  const base = eventToSound(ev, ev.node);
  assert.equal(base.name, 'machine-on');
  const s = labEventSound(ev, ev.node, { view: 'lab' });
  assert.equal(s.name, 'lab-rig-on');
  for (const k of ['priority', 'pitchIndex', 'pan', 'key']) assert.equal(s[k], base[k], k);
  assert.deepEqual(labEventSound(ev, ev.node, { view: 'voxel' }), base);
  // 기존 규칙이 조용한 기자재 끝(bash-bg done) → 연구소에선 끝 종지를 새로
  const done = { type: 'node-update', nodeId: 'b:1', patch: { status: 'done' } };
  assert.equal(eventToSound(done, { kind: 'bash-bg' }), null);
  const d = labEventSound(done, { kind: 'bash-bg' }, { view: 'lab' });
  assert.equal(d.name, 'lab-rig-done'); assert.equal(d.priority, LAB_SFX_PRI['lab-rig-done']); assert.equal(d.key, 'b:1');
  // 소리 없는 이벤트는 그대로 null
  assert.equal(labEventSound({ type: 'node-update', patch: { status: 'running' } }, { kind: 'bash-bg' }, { view: 'lab' }), null);
});

test('제한: 같은 이름 0.25초 안 1번 → RateLimiter(초당 8) → voice ≤ 6, 배속 솎기', () => {
  const gate = new LabSoundGate();
  assert.equal(gate.allow('lab-print', 0), true);
  assert.equal(gate.allow('lab-print', 249), false);
  assert.equal(gate.allow('lab-edit', 100), true, '다른 이름은 따로');
  assert.equal(gate.allow('lab-print', 250), true);
  assert.equal(gate.allow('done', 251), true, '연구소 소리가 아니면 통과');
  assert.equal(gate.allow('done', 252), true);
  // 1초에 200번(5ms 간격) 연구소 소리 폭주 → 문 + RateLimiter 를 지나는 건 버킷(4) + 초당 8 이하
  const g2 = new LabSoundGate(), lim = new RateLimiter();
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const t = 10_000 + i * 5;
    const name = LAB_SFX_NAMES[i % LAB_SFX_NAMES.length];
    if (!g2.allow(name, t)) continue;
    if (lim.allow({ name, priority: LAB_SFX_PRI[name], key: 'n' + (i % 7) }, t, 1)) n++;
  }
  assert.ok(n >= 4 && n <= 13, `1초 ${n}`);
  // 배속 솎기
  assert.equal(labSpeedOk('lab-edit', 1), true);
  assert.equal(labSpeedOk('lab-edit', 8), false);
  assert.equal(labSpeedOk('lab-print', 8), true);
  assert.equal(labSpeedOk('lab-print', 16), false);
  assert.equal(labSpeedOk('lab-alarm', 32), true);
  // Sfx.play: 연구소 소리 10개를 한꺼번에 → voice ≤ MAX_VOICES(6)
  const { ctx } = recCtx();
  function Ctx() { return ctx; }
  const sfx = new Sfx({ AudioCtx: Ctx, storage: null });
  sfx.setEnabled(true);
  for (const name of LAB_SFX_NAMES.slice(0, 10)) sfx.play(name, { priority: 2 });
  assert.equal(MAX_VOICES, 6);
  assert.ok(sfx.voices.filter((v) => v.end > 0).length <= 6);
  assert.ok(sfx.stats.played >= 6);
  sfx.dispose();
});

// ───────── 배경음악: 연구소 8곡 · 풀 대체 ─────────
const manifest = JSON.parse(readFileSync(new URL('../assets/bgm-tracks.json', import.meta.url), 'utf8'));
const LAB_IDS = LAB_TRACKS.flat();

test('배경음악 매니페스트: 연구소 13곡(한가 2·보통 6·활발 3·매우 활발 2) — views 는 lab 만, 메타 300초·박자·영어 이름, 합성 스크립트 존재', () => {
  assert.equal(LAB_IDS.length, 13);
  assert.deepEqual(LAB_TRACKS.map((x) => x.length), [2, 6, 3, 2]);
  const METER = { microscope: '3/4', fivetubes: '5/4', coolant: '6/8' };
  for (let st = 0; st < 4; st++) for (const id of LAB_TRACKS[st]) {
    const t = manifest.tracks.find((x) => x.id === id);
    assert.ok(t, `매니페스트 ${id}`);
    assert.deepEqual(t.views, { lab: [st] }, `${id} views`);
    assert.equal(t.stage, st, `${id} stage`);
    assert.ok(t.energy >= st / 4 - 0.05 && t.energy <= (st + 1) / 4 + 0.05, `${id} energy ${t.energy}`);
    assert.equal(t.file, `bgm-${id}.mp3`);
    assert.ok(t.label_en && t.title_en && t.mood_en, `${id} 영어`);
    assert.match(t.hash || '', /^[0-9a-f]{16}$/);
    const meta = JSON.parse(readFileSync(new URL(`../assets/bgm-${id}.json`, import.meta.url), 'utf8'));
    assert.equal(meta.duration, 300); assert.equal(meta.meter, METER[id] || '4/4'); assert.equal(meta.stage, st);
    assert.ok(meta.sections.length >= 4);
    assert.ok(existsSync(new URL(`../../music/compose_${id}.py`, import.meta.url)), `compose_${id}.py`);
  }
  const ids = manifest.tracks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'id 중복 없음');
  // 다른 표현 풀에는 연구소 곡이 섞이지 않음
  const m = parseManifest(manifest);
  for (const v of ['flow', 'planet', 'voxel']) for (let i = 0; i < 4; i++) {
    const c = viewCandidates(i, m.tracks, v);
    assert.ok(c.every((id) => !LAB_IDS.includes(id)), `${v} ${i}: ${c}`);
  }
  const py = readFileSync(new URL('../../music/tracks.py', import.meta.url), 'utf8');
  assert.match(py, /VIEWS = \("flow", "planet", "voxel", "lab"\)/);
  assert.ok(existsSync(new URL('../../music/labkit.py', import.meta.url)));
});

test('배경음악 풀: lab 곡이 없으면 복셀 오피스 풀(labPoolView), 있으면 연구소 풀 — 다른 표현은 그대로', () => {
  assert.equal(LAB_BGM_FALLBACK, 'voxel');
  const tr = [{ id: 'a', stage: [1], views: { voxel: [1] } }, { id: 'b', stage: [1], views: { flow: [1] } }];
  assert.equal(labPoolView(tr, 'lab'), 'voxel');
  assert.deepEqual(viewCandidates(1, tr, 'lab'), ['a']);
  assert.equal(labPoolView(tr, 'flow'), 'flow');
  assert.equal(labPoolView(tr, null), null);
  assert.equal(labPoolView(null, 'lab'), 'lab');
  const tr2 = tr.concat([{ id: 'c', stage: [1], views: { lab: [1] } }]);
  assert.equal(labPoolView(tr2, 'lab'), 'lab');
  // 실제 매니페스트(파싱 뒤): bgm-core VIEWS 에 lab 이 있으면 연구소 풀, 아직 없으면(리드 연결 전) 복셀 오피스 풀
  const m = parseManifest(manifest);
  for (let i = 0; i < 4; i++) {
    const c = viewCandidates(i, m.tracks, 'lab');
    if (VIEWS.includes('lab')) assert.deepEqual(c.sort(), [...LAB_TRACKS[i]].sort(), `lab ${i}`);
    else assert.deepEqual(c.sort(), viewCandidates(i, m.tracks, 'voxel').sort(), `lab ${i} → voxel`);
    for (let k = 0; k < 10; k++) assert.ok(c.includes(pickForLevel(i, m.tracks, { view: 'lab', recent: [c[0]], rand: () => k / 10 })));
  }
});
