// 효과음. WebAudio 실시간 합성만 쓴다 — 샘플 파일·fetch 없음.
//   const sfx = new Sfx({ getMusicTime: () => music.on ? audio.currentTime : null });
//   sfx.setEnabled(true)  (사용자 동작 안에서)
//   sfx.onEvent(ev, { node, speed, quiet, replay })
// 순수 함수(eventToSound·RateLimiter·scaleNotes·noteFor)는 node --test 로 시험한다.

import { t as tr } from './i18n.mjs';

// ───────────────────────── 음계 (배경음악 music/compose.py 와 같은 화음표) ─────────────────────────
// compose.py: 96 BPM, 4/4, 1마디 2.5초, 120마디 = 300초. CH·PROG_A·PROG_C·build_chords() 를 그대로 옮김.
export const BAR_SEC = 2.5;
export const BARS = 120;
export const CHORD_NOTES = {
  Dm9: [50, 53, 57, 60, 64],
  Bbmaj9: [46, 53, 57, 60, 62],
  Fmaj7: [41, 53, 57, 60, 64],
  C69: [48, 55, 57, 62, 64],
  Gm9: [43, 50, 53, 57, 58],
  'Ebmaj7#11': [39, 51, 55, 58, 62],
  A7: [45, 52, 55, 57, 61],
};
const PROG_A = ['Dm9', 'Bbmaj9', 'Fmaj7', 'C69'];
const PROG_C = ['Gm9', 'Ebmaj7#11', 'Bbmaj9', 'A7'];
export function chordAtBar(b) {
  b = ((Math.floor(b) % BARS) + BARS) % BARS;
  if (b < 60) { const lb = b < 30 ? b : b - 30; return PROG_A[Math.floor(lb / 2) % 4]; }
  if (b < 90) { const lb = b - 60; if (lb >= 28) return 'A7'; return PROG_C[Math.floor(lb / 2) % 4]; }
  const lb = b - 90;
  if (lb < 16) return ['Dm9', 'Bbmaj9', 'Gm9', 'Dm9'][Math.floor(lb / 2) % 4];
  if (lb < 18) return 'Bbmaj9';
  if (lb < 20) return 'Gm9';
  return 'Dm9';
}
export const D_PENTA_PC = [2, 5, 7, 9, 0]; // D F G A C
const BASE = 62; // D4 — scaleNotes 는 D4..C#5 한 옥타브 안의 MIDI 번호로 돌려준다
const pcToMidi = (pc) => BASE + (((pc - 2) % 12) + 12) % 12;

/** 지금 쓸 음(MIDI, D4 위 한 옥타브 안, 오름차순). musicTimeSec 가 null 이면 D 단조 5음 */
export function scaleNotes(musicTimeSec) {
  if (musicTimeSec == null || !isFinite(musicTimeSec)) return D_PENTA_PC.map(pcToMidi).sort((a, b) => a - b);
  const chord = CHORD_NOTES[chordAtBar(musicTimeSec / BAR_SEC)];
  const pcs = [...new Set(chord.map((m) => m % 12))];
  let use = pcs.filter((pc) => D_PENTA_PC.includes(pc));
  if (use.length < 2) use = pcs;
  return [...new Set(use.map(pcToMidi))].sort((a, b) => a - b);
}

export const REGISTERS = { low: [50, 57], mid: [62, 74], high: [74, 93] }; // D3～A3, D4～D5, D5～A6
/** 음계 notes 를 음역 안으로 펼쳐 index 번째 음(MIDI) */
export function noteFor(notes, register = 'mid', index = 0) {
  const [lo, hi] = REGISTERS[register] || REGISTERS.mid;
  const pcs = [...new Set(notes.map((m) => ((m % 12) + 12) % 12))];
  const all = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) all.push(m);
  if (!all.length) return lo;
  return all[((index % all.length) + all.length) % all.length];
}
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ───────────────────────── 이벤트 → 소리 ─────────────────────────
const TOOL_SOUND = {
  skill: 'skill', shell: 'shell', read: 'page', write: 'type', edit: 'type2', search: 'scan', agent: 'whoosh',
  workflow: 'ring', web: 'ping', monitor: 'sonar', mcp: 'fm2', artifact: 'pluck', notify: 'chime', other: 'tick',
};
const SPAWN_SOUND = { subagent: 'spawn', 'workflow-agent': 'spawn-soft', workflow: 'workflow', 'claude-p': 'spawn-p', 'bash-bg': 'machine-on', monitor: 'machine-on' };
const DONE_KINDS = new Set(['subagent', 'workflow-agent', 'claude-p', 'workflow']);

/**
 * 특별 상호작용 소리(순수). ix 가 있는 이벤트 중 의미 있는 순간만 — [이름, 우선순위] 또는 null(기본 규칙으로).
 * push = 상승 휘슁, pull = 하강, CI·테스트 실패 = 낮은 두 음(오류음보다 부드럽게), 전부 통과 = 짧은 상행 아르페지오, ssh 연결 = 접속음 …
 */
export function ixSound(ev) {
  const ix = ev && ev.ix;
  if (!ix || !ix.cat) return null;
  const end = ix.phase === 'end', ok = ix.ok !== false;
  switch (ix.cat) {
    case 'user': // 사용자 메시지 = 부드러운 두 음 차임, 질문 대기 = 아주 작은 핑, 거부·중단 = 작은 중지음
      if (ix.op === 'prompt' || ix.op === 'command' || ix.op === 'midturn') return ['ix-chime', 1];
      if (ix.op === 'ask') return ev.type === 'tool-start' ? ['ix-ping', 2] : null;
      if (ix.op === 'deny' || ix.op === 'interrupt') return ['stop', 2];
      return ix.op === 'auto' ? ['__none', 9] : null;
    case 'github':
      if (!end) return null;
      if ((ix.op === 'pr-checks' || ix.op === 'run') && ix.ci) return ix.ci.fail ? ['ix-fail2', 1] : ix.ci.pending ? null : ['ix-pass', 1];
      if (!ok) return ['ix-fail2', 1];
      if (ix.op === 'push') return ix.upToDate ? ['ix-stamp', 3] : ['ix-push', 1];
      if (ix.op === 'pull' || ix.op === 'fetch' || ix.op === 'clone') return ix.upToDate ? null : ['ix-pull', 2];
      if (ix.op === 'pr-create') return ['ix-pr', 1];
      if (ix.op === 'pr-merge' || ix.op === 'merge' || ix.op === 'rebase') return ['ix-merge', 1];
      if (ix.op === 'commit') return ['ix-stamp', 3];
      return null;
    case 'tests':
      if (!end) return null;
      if (ix.fail > 0 || !ok) return ['ix-fail2', 1];
      return ix.pass ? ['ix-pass', 1] : null;
    case 'remote':
      if (ev.type === 'tool-start') return ['ix-connect', 2];
      if (end && !ok) return ['ix-fail2', 1];
      if (end && ix.transfer) return ['ix-pull', 3];
      return null;
    case 'db':
      if (ev.type === 'tool-start') return ['ix-db', 2];
      return end && !ok ? ['ix-fail2', 1] : null;
    case 'batch':
      if (ix.op === 'fan') return ix.i === 4 ? ['ix-fan', 2] : null;
      if (ix.op === 'streak') return null;
      if (end && !ok) return ['ix-fail2', 1];
      if (end && (ix.n >= 20 || ix.op === 'workflow')) return ['ix-batch', 2];
      return null;
    default: return null;
  }
}

/** 순수: 이벤트(+그 노드)에 맞는 소리. 소리 없으면 null */
export function eventToSound(ev, node) {
  if (!ev || !ev.type) return null;
  const id = ev.nodeId || (ev.node && ev.node.id) || '';
  const kind = (node && node.kind) || (ev.node && ev.node.kind) || null;
  const h = hashStr(id);
  const pitchIndex = h % 7;
  const pan = kind === 'main' ? 0 : Math.round((((h >>> 8) % 81) / 100 - 0.4) * 100) / 100; // main 0, 그 밖 −0.4～0.4
  const mk = (name, priority, extra = {}) => ({ name, priority, pitchIndex, pan, key: id, ...extra });
  if (ev.ix) { const s = ixSound(ev); if (s) return s[0] === '__none' ? null : mk(s[0], s[1], { cat: 'ix-' + ev.ix.cat }); if (ev.type === 'output') return null; }
  switch (ev.type) {
    case 'node-add': {
      const k = ev.node && ev.node.kind;
      const name = SPAWN_SOUND[k];
      if (!name) return null;
      return mk(name, name === 'machine-on' ? 2 : 1);
    }
    case 'node-update': {
      const st = ev.patch && ev.patch.status;
      if (st === 'error') return mk('error', 0);
      if (st === 'stopped') return mk('stop', 2); // 일부러 끈 작업: 실패음 대신 작게 내려앉는 소리
      if (st === 'done' && DONE_KINDS.has(kind)) return mk('done', 1);
      return null;
    }
    case 'tool-start': {
      const name = TOOL_SOUND[ev.cat] || 'tick';
      return mk(name, name === 'skill' ? 1 : 2, { cat: ev.cat || 'other' });
    }
    case 'tool-end':
      if (ev.ok === false) return mk('error', 0);
      return mk('end-tick', 3, { cat: ev.cat || 'other' });
    case 'result':
      return ev.ok === false ? mk('error', 0) : mk('done', 1);
    case 'user':
      return ev.origin === 'human' ? mk('user', 0) : null;
    case 'output':
      return mk('blip', 3);
    default:
      return null;
  }
}

// ───────────────────────── 레이트 리밋 ─────────────────────────
export class RateLimiter {
  constructor({ rate = 8, burst = 4, minGapMs = 90, p0GapMs = 150, mergeMs = 250, blipNodeMs = 2000, doneMergeMs = 1200 } = {}) {
    Object.assign(this, { rate, burst, minGapMs, p0GapMs, mergeMs, blipNodeMs, doneMergeMs });
    this.tokens = burst;
    this.tokT = null;
    this.lastName = new Map();   // name → ms
    this.lastKey = new Map();    // key|name → ms
    this.win = { 8: { w: -1, used: false, counts: new Map(), prevTop: null }, 16: { w: -1, used: false } };
    this.recent32 = [];          // 32× 에서 지난 1초 안에 낸 소리 시각
  }

  _refill(now) {
    if (this.tokT == null) { this.tokT = now; return; }
    const dt = Math.max(0, now - this.tokT);
    this.tokens = Math.min(this.burst, this.tokens + (dt * this.rate) / 1000);
    this.tokT = now;
  }

  /** s = {priority, name, key, cat}. 허용하면 기록까지 하고 true */
  allow(s, now, speed = 1) {
    if (!s) return false;
    const p = s.priority ?? 2;
    const name = s.name;
    const key = (s.key || '') + '|' + name;
    speed = speed || 1;
    this._refill(now);

    // 1) 재생 속도별 솎아내기
    if (speed >= 32) {
      if (!(p === 0 || /^spawn/.test(name))) return false;
      this.recent32 = this.recent32.filter((t) => now - t < 1000);
      if (this.recent32.length >= 4) return false;
    } else if (speed >= 16) {
      if (p >= 2) return false;
      if (p === 1) {
        const W = this.win[16];
        const w = Math.floor(now / 500);
        if (W.w !== w) { W.w = w; W.used = false; }
        if (W.used) return false;
      }
    } else if (speed >= 4) {
      if (p >= 3) return false;
      if (speed >= 8 && p === 2) {
        // 300ms 창마다 P2 하나: 직전 창에서 가장 잦았던 cat 을 고르고, 그 cat 이 안 오면 창 중간 이후 첫 것
        const W = this.win[8];
        const w = Math.floor(now / 300);
        if (W.w !== w) {
          let top = null, max = 0;
          for (const [c, n] of W.counts) if (n > max) { max = n; top = c; }
          W.prevTop = W.w === w - 1 ? top : null;
          W.w = w; W.used = false; W.counts = new Map();
        }
        const cat = s.cat || name;
        W.counts.set(cat, (W.counts.get(cat) || 0) + 1);
        if (W.used) return false;
        const inWin = now - w * 300;
        if (!(W.prevTop == null || cat === W.prevTop || inWin >= 150)) return false;
      }
    }

    // 2) 같은 노드·같은 소리 합치기(도구 연타·완료+결과 중복·출력 2초 1회)
    const lk = this.lastKey.get(key);
    const mergeWin = name === 'blip' ? this.blipNodeMs : name === 'done' ? this.doneMergeMs : this.mergeMs;
    if (lk != null && now - lk < mergeWin) return false;

    // 3) 같은 이름 최소 간격 · P0 은 버킷 예외
    const ln = this.lastName.get(name);
    if (p === 0) {
      if (ln != null && now - ln < this.p0GapMs) return false;
    } else {
      if (ln != null && now - ln < this.minGapMs) return false;
      if (this.tokens < 1) return false;
      this.tokens -= 1;
    }

    // 기록
    this.lastName.set(name, now);
    this.lastKey.set(key, now);
    if (speed >= 32) this.recent32.push(now);
    if (speed >= 16 && speed < 32 && p === 1) this.win[16].used = true;
    if (speed >= 8 && speed < 16 && p === 2) this.win[8].used = true;
    if (this.lastKey.size > 512) { for (const [k, t] of this.lastKey) if (now - t > 5000) this.lastKey.delete(k); }
    return true;
  }
}

// ───────────────────────── 합성 (소리 표) ─────────────────────────
// 모든 소리: attack ≥ 5ms, release ≥ 30ms, 길이 ≤ 400ms (done ≤ 900ms).
export const SOUNDS = {
  error: { dur: 0.36, register: 'low', desc: '낮은 삼각파 두 음 하강(반음), lowpass 900Hz' },
  user: { dur: 1.36, register: 'high', desc: '은은한 슝(대역 잡음 상승) → 도착 때 벨 두 음(근음+5도) — §96 빛줄기' },
  spawn: { dur: 0.34, register: 'high', desc: '사인+삼각 2음 상행 아르페지오' },
  'spawn-soft': { dur: 0.34, register: 'high', octave: 1, desc: 'spawn 한 옥타브 위, 게인 0.6' },
  workflow: { dur: 0.38, register: 'mid', desc: '3음 아르페지오' },
  'spawn-p': { dur: 0.4, register: 'mid', desc: '낮은 벨 + 5도' },
  'machine-on': { dur: 0.16, register: 'low', desc: '짧은 노이즈 클릭 + 사각파 블립' },
  done: { dur: 0.85, register: 'mid', desc: '5도→근음 종지' },
  skill: { dur: 0.34, register: 'high', desc: '고음 3음 빠른 상행 + 고역 노이즈 반짝임' },
  shell: { dur: 0.2, register: 'low', desc: '사각파 짧은 저음 2연타' },
  page: { dur: 0.24, register: 'mid', desc: '대역 노이즈 스윕(종이 넘김)' },
  type: { dur: 0.16, register: 'mid', desc: '고역 노이즈 클릭 2회' },
  type2: { dur: 0.22, register: 'mid', desc: '고역 노이즈 클릭 3회' },
  scan: { dur: 0.22, register: 'mid', desc: '사인 2음 빠른 상행' },
  whoosh: { dur: 0.34, register: 'mid', desc: '밴드패스 노이즈 상승' },
  ring: { dur: 0.34, register: 'mid', desc: '사인 고리 3음' },
  ping: { dur: 0.3, register: 'mid', desc: '2-op FM 핑' },
  sonar: { dur: 0.36, register: 'mid', desc: '사인 핑 + 120ms 뒤 작은 반복' },
  fm2: { dur: 0.3, register: 'mid', desc: 'FM 2음' },
  pluck: { dur: 0.22, register: 'mid', desc: '짧은 감쇠 삼각파' },
  chime: { dur: 0.38, register: 'high', desc: '벨 1음' },
  tick: { dur: 0.06, register: 'mid', desc: '아주 짧은 클릭' },
  'end-tick': { dur: 0.06, register: 'mid', desc: '작은 클릭, 게인 0.3' },
  blip: { dur: 0.07, register: 'high', desc: '아주 작은 블립' },
  glitch: { dur: 0.34, register: 'low', desc: '신호 열화 문턱: 끊기는 노이즈 지직 4토막 + 사각파 하강 블립' },
  stop: { dur: 0.3, register: 'low', desc: '중지됨: 사인 한 음이 5도 아래로 미끄러지며 꺼짐(lowpass, 작게)' },
  // 특별 상호작용
  'ix-push': { dur: 0.36, register: 'mid', desc: 'push: 대역 노이즈 상승 휘슁 + 사인 한 옥타브 상승' },
  'ix-pull': { dur: 0.3, register: 'mid', desc: 'pull·fetch·전송: 대역 노이즈 하강 + 사인 하강(작게)' },
  'ix-pr': { dur: 0.38, register: 'high', desc: 'PR 생성: FM 벨 근음+5도' },
  'ix-merge': { dur: 0.32, register: 'mid', desc: '병합: 위·아래 두 음이 근음으로 모임' },
  'ix-fail2': { dur: 0.38, register: 'low', desc: 'CI·테스트 실패: 낮은 두 음(온음 하강, lowpass 700Hz — 오류음보다 부드럽게)' },
  'ix-pass': { dur: 0.38, register: 'mid', desc: '테스트 전부 통과: 4음 상행 아르페지오' },
  'ix-connect': { dur: 0.24, register: 'high', desc: 'ssh·원격 접속음: 짧은 클릭 + FM 블립 두 번 상승' },
  'ix-db': { dur: 0.2, register: 'mid', desc: 'DB 쿼리: 사인 음높이가 빠르게 내려가는 물방울 소리' },
  'ix-fan': { dur: 0.3, register: 'mid', desc: '동시 분기: 짧은 노이즈 세 번(높아짐)' },
  'ix-batch': { dur: 0.34, register: 'high', desc: '대량 처리 끝: 벨 두 음 상행(작게)' },
  'ix-stamp': { dur: 0.08, register: 'low', desc: '커밋 도장: 낮은 클릭' },
  'ix-chime': { dur: 0.4, register: 'high', desc: '사용자 메시지 도착: 부드러운 사인 두 음 차임(근음 → 5도, 느린 어택)' },
  'ix-ping': { dur: 0.14, register: 'high', desc: '질문 대기: 아주 작은 핑' },
  // 작업 대상 상호작용(착지 순간만 — 도구 시작·특별 상호작용 소리와 겹치지 않게)
  'act-build': { dur: 0.3, register: 'low', desc: '새 대상 건설: 낮은 나무 블록 두 번 쌓임(삼각파 근음 → 5도) + 짧은 저역 노이즈' },
  'act-crumble': { dur: 0.34, register: 'low', desc: '삭제: 대역 노이즈가 아래로 무너지는 소리 3토막(작게)' },
  'act-flash': { dur: 0.26, register: 'high', desc: '산출물 플래시: 고역 노이즈 셔터 클릭 + 사인 반짝임' },
};

const A = 0.005;  // attack
const R = 0.03;   // 최소 release

function env(ctx, dest, t0, dur, peak, attack = A) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.max(A, attack));
  g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak * 0.001), t0 + Math.max(attack + R, dur));
  g.gain.linearRampToValueAtTime(0, t0 + Math.max(attack + R, dur) + 0.005);
  g.connect(dest);
  return g;
}
function osc(ctx, type, freq, t0, dur, dest, peak, { attack, freqEnd, detune } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  if (detune) o.detune.setValueAtTime(detune, t0);
  const g = env(ctx, dest, t0, dur, peak, attack);
  o.connect(g);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  return o;
}
const noiseCache = new WeakMap();
function noiseBuf(ctx) {
  let b = noiseCache.get(ctx);
  if (b) return b;
  const n = Math.floor(ctx.sampleRate * 0.5);
  b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 2026;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  noiseCache.set(ctx, b);
  return b;
}
function noise(ctx, t0, dur, dest, peak, { type = 'bandpass', f = 3000, fEnd = null, q = 1, attack } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, t0);
  if (fEnd) flt.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
  flt.Q.value = q;
  const g = env(ctx, dest, t0, dur, peak, attack);
  src.connect(flt); flt.connect(g);
  src.start(t0, (hashStr(String(t0)) % 1000) / 4000);
  src.stop(t0 + dur + 0.02);
  return src;
}
function fm(ctx, freq, t0, dur, dest, peak, { ratio = 2, index = 2.5, idxDecay = 0.12 } = {}) {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const mg = ctx.createGain();
  car.frequency.setValueAtTime(freq, t0);
  mod.frequency.setValueAtTime(freq * ratio, t0);
  mg.gain.setValueAtTime(freq * index, t0);
  mg.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.15), t0 + Math.max(0.02, idxDecay));
  mod.connect(mg); mg.connect(car.frequency);
  const g = env(ctx, dest, t0, dur, peak);
  car.connect(g);
  car.start(t0); mod.start(t0);
  car.stop(t0 + dur + 0.02); mod.stop(t0 + dur + 0.02);
  return car;
}
const up = (notes, register, idx, steps) => noteFor(notes, register, idx + steps);
const semis = (m, s) => mtof(m + s);

/**
 * 소리 하나를 ctx 위에 만든다(실시간·OfflineAudioContext 공용).
 * opts: { notes(scaleNotes 결과), pitchIndex, gain }  반환: 끝나는 시각(초)
 */
export function synth(ctx, dest, name, t0, { notes = scaleNotes(null), pitchIndex = 0, gain = 1 } = {}) {
  const spec = SOUNDS[name];
  if (!spec) return t0;
  const reg = spec.register;
  const n0 = noteFor(notes, reg, pitchIndex);
  const G = gain;
  switch (name) {
    case 'error': {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7; lp.connect(dest);
      osc(ctx, 'triangle', mtof(n0), t0, 0.17, lp, 0.5 * G);
      osc(ctx, 'triangle', semis(n0, -1), t0 + 0.15, 0.2, lp, 0.5 * G);
      return t0 + 0.37;
    }
    case 'user': { // 빛줄기와 같이: 은은한 '슝'(올라가는 대역 잡음) → 도착 때 '톡'(예전 두 음 벨을 짧게)
      noise(ctx, t0, 0.95, dest, 0.045 * G, { type: 'bandpass', f: 520, fEnd: 2400, q: 1.3, attack: 0.4 });
      const r = noteFor(notes, 'high', 0);
      fm(ctx, mtof(r), t0 + 1.0, 0.26, dest, 0.2 * G, { ratio: 2, index: 1.2, idxDecay: 0.15 });
      fm(ctx, semis(r, 7), t0 + 1.08, 0.26, dest, 0.15 * G, { ratio: 2, index: 1.0, idxDecay: 0.15 });
      return t0 + 1.36;
    }
    case 'spawn':
    case 'spawn-soft': {
      const oct = spec.octave ? 12 : 0, k = name === 'spawn-soft' ? 0.6 : 1;
      const a = n0 + oct, b = up(notes, reg, pitchIndex, 1) + oct;
      for (const [m, dt] of [[a, 0], [b, 0.1]]) {
        osc(ctx, 'sine', mtof(m), t0 + dt, 0.22, dest, 0.22 * G * k);
        osc(ctx, 'triangle', mtof(m), t0 + dt, 0.18, dest, 0.08 * G * k);
      }
      return t0 + 0.34;
    }
    case 'workflow': {
      for (let i = 0; i < 3; i++) osc(ctx, 'triangle', mtof(up(notes, reg, pitchIndex, i)), t0 + i * 0.08, 0.2, dest, 0.2 * G);
      return t0 + 0.38;
    }
    case 'spawn-p': {
      const m = noteFor(notes, 'mid', pitchIndex % 2);
      fm(ctx, mtof(m), t0, 0.38, dest, 0.2 * G, { ratio: 1.4, index: 1.8, idxDecay: 0.2 });
      fm(ctx, semis(m, 7), t0 + 0.01, 0.36, dest, 0.13 * G, { ratio: 1.4, index: 1.4, idxDecay: 0.2 });
      return t0 + 0.4;
    }
    case 'machine-on': {
      noise(ctx, t0, 0.04, dest, 0.25 * G, { type: 'highpass', f: 2500 });
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(dest);
      osc(ctx, 'square', mtof(n0), t0 + 0.03, 0.11, lp, 0.14 * G);
      return t0 + 0.16;
    }
    case 'stop': {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 0.5; lp.connect(dest);
      const f0 = mtof(n0 + 12);
      osc(ctx, 'sine', f0, t0, 0.26, lp, 0.16 * G, { freqEnd: f0 * Math.pow(2, -7 / 12), attack: 0.008 });
      return t0 + 0.3;
    }
    case 'done': {
      const r = noteFor(notes, 'mid', 0);
      osc(ctx, 'sine', semis(r, 7), t0, 0.26, dest, 0.22 * G);
      osc(ctx, 'triangle', semis(r, 7), t0, 0.2, dest, 0.06 * G);
      osc(ctx, 'sine', mtof(r), t0 + 0.2, 0.62, dest, 0.24 * G, { attack: 0.01 });
      osc(ctx, 'triangle', mtof(r - 12), t0 + 0.2, 0.55, dest, 0.06 * G, { attack: 0.01 });
      return t0 + 0.84;
    }
    case 'skill': {
      for (let i = 0; i < 3; i++) osc(ctx, 'sine', mtof(up(notes, reg, pitchIndex % 3, i)), t0 + i * 0.06, 0.16, dest, 0.16 * G);
      noise(ctx, t0 + 0.12, 0.2, dest, 0.06 * G, { type: 'highpass', f: 7000 });
      return t0 + 0.34;
    }
    case 'shell': {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(dest);
      osc(ctx, 'square', mtof(n0), t0, 0.06, lp, 0.13 * G);
      osc(ctx, 'square', mtof(n0), t0 + 0.09, 0.08, lp, 0.11 * G);
      return t0 + 0.2;
    }
    case 'page':
      noise(ctx, t0, 0.22, dest, 0.28 * G, { type: 'bandpass', f: 1200, fEnd: 3800, q: 1.4, attack: 0.03 });
      return t0 + 0.24;
    case 'type':
    case 'type2': {
      const k = name === 'type' ? 2 : 3;
      for (let i = 0; i < k; i++) noise(ctx, t0 + i * 0.06, 0.035, dest, 0.18 * G, { type: 'highpass', f: 4000 + i * 600 });
      return t0 + (k - 1) * 0.06 + 0.06;
    }
    case 'scan': {
      osc(ctx, 'sine', mtof(n0), t0, 0.1, dest, 0.16 * G);
      osc(ctx, 'sine', mtof(up(notes, reg, pitchIndex, 2)), t0 + 0.07, 0.13, dest, 0.16 * G);
      return t0 + 0.22;
    }
    case 'whoosh':
      noise(ctx, t0, 0.32, dest, 0.34 * G, { type: 'bandpass', f: 400, fEnd: 2600, q: 2, attack: 0.08 });
      return t0 + 0.34;
    case 'ring': {
      for (let i = 0; i < 3; i++) osc(ctx, 'sine', mtof(up(notes, reg, pitchIndex, i * 2) + 12), t0 + i * 0.07, 0.18, dest, 0.12 * G);
      return t0 + 0.34;
    }
    case 'ping':
      fm(ctx, mtof(n0 + 12), t0, 0.28, dest, 0.16 * G, { ratio: 3.5, index: 2.0, idxDecay: 0.08 });
      return t0 + 0.3;
    case 'sonar': {
      osc(ctx, 'sine', mtof(n0 + 12), t0, 0.16, dest, 0.18 * G);
      osc(ctx, 'sine', mtof(n0 + 12), t0 + 0.12, 0.2, dest, 0.06 * G);
      return t0 + 0.34;
    }
    case 'fm2': {
      fm(ctx, mtof(n0), t0, 0.14, dest, 0.15 * G, { ratio: 1.5, index: 2.2, idxDecay: 0.06 });
      fm(ctx, mtof(up(notes, reg, pitchIndex, 1)), t0 + 0.09, 0.18, dest, 0.15 * G, { ratio: 1.5, index: 2.2, idxDecay: 0.06 });
      return t0 + 0.3;
    }
    case 'pluck': {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t0); lp.frequency.exponentialRampToValueAtTime(600, t0 + 0.2); lp.connect(dest);
      osc(ctx, 'triangle', mtof(n0), t0, 0.2, lp, 0.3 * G);
      return t0 + 0.22;
    }
    case 'chime':
      fm(ctx, mtof(noteFor(notes, 'high', pitchIndex)), t0, 0.36, dest, 0.17 * G, { ratio: 3, index: 1.3, idxDecay: 0.2 });
      return t0 + 0.38;
    case 'tick':
    case 'end-tick': {
      const k = name === 'end-tick' ? 0.3 : 1;
      noise(ctx, t0, 0.035, dest, 0.12 * G * k, { type: 'bandpass', f: 3000, q: 2 });
      osc(ctx, 'sine', 2000, t0, 0.035, dest, 0.05 * G * k);
      return t0 + 0.06;
    }
    case 'glitch': {
      // 지직: 대역 노이즈 짧은 토막 4개(간격 불규칙) + 낮은 사각파가 떨어짐(비트 깨진 느낌)
      const gaps = [0, 0.045, 0.11, 0.2], lens = [0.03, 0.05, 0.025, 0.07];
      for (let i = 0; i < 4; i++) noise(ctx, t0 + gaps[i], lens[i], dest, (0.26 - i * 0.03) * G, { type: 'bandpass', f: 1800 + i * 900, q: 0.9 });
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; lp.connect(dest);
      osc(ctx, 'square', mtof(n0 + 12), t0 + 0.02, 0.24, lp, 0.07 * G, { freqEnd: mtof(n0 - 5) });
      return t0 + 0.32;
    }
    case 'blip':
      osc(ctx, 'sine', mtof(n0 + 12), t0, 0.05, dest, 0.06 * G);
      return t0 + 0.07;
    // ---- 특별 상호작용 ----
    case 'ix-push':
      noise(ctx, t0, 0.32, dest, 0.2 * G, { type: 'bandpass', f: 500, fEnd: 3600, q: 2.2, attack: 0.06 });
      osc(ctx, 'sine', mtof(n0), t0 + 0.02, 0.3, dest, 0.09 * G, { freqEnd: mtof(n0 + 12), attack: 0.03 });
      return t0 + 0.36;
    case 'ix-pull':
      noise(ctx, t0, 0.26, dest, 0.13 * G, { type: 'bandpass', f: 3200, fEnd: 600, q: 2, attack: 0.02 });
      osc(ctx, 'sine', mtof(n0 + 12), t0, 0.24, dest, 0.06 * G, { freqEnd: mtof(n0), attack: 0.01 });
      return t0 + 0.3;
    case 'ix-pr': {
      const r = noteFor(notes, 'high', pitchIndex % 2);
      fm(ctx, mtof(r), t0, 0.32, dest, 0.15 * G, { ratio: 3, index: 1.4, idxDecay: 0.18 });
      fm(ctx, semis(r, 7), t0 + 0.08, 0.3, dest, 0.12 * G, { ratio: 3, index: 1.2, idxDecay: 0.18 });
      return t0 + 0.38;
    }
    case 'ix-merge': {
      const r = noteFor(notes, 'mid', 0);
      osc(ctx, 'sine', semis(r, 4), t0, 0.28, dest, 0.12 * G, { freqEnd: mtof(r), attack: 0.01 });
      osc(ctx, 'sine', semis(r, -5), t0, 0.28, dest, 0.12 * G, { freqEnd: mtof(r), attack: 0.01 });
      return t0 + 0.32;
    }
    case 'ix-fail2': {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.6; lp.connect(dest);
      const r = noteFor(notes, 'low', 0);
      osc(ctx, 'triangle', mtof(r + 12), t0, 0.16, lp, 0.32 * G, { attack: 0.01 });
      osc(ctx, 'triangle', semis(r + 12, -2), t0 + 0.17, 0.2, lp, 0.32 * G, { attack: 0.01 });
      return t0 + 0.38;
    }
    case 'ix-pass': {
      for (let i = 0; i < 4; i++) osc(ctx, 'sine', mtof(up(notes, 'mid', 0, i + 1)), t0 + i * 0.065, 0.16, dest, 0.12 * G);
      noise(ctx, t0 + 0.22, 0.14, dest, 0.03 * G, { type: 'highpass', f: 8000 });
      return t0 + 0.38;
    }
    case 'ix-connect':
      noise(ctx, t0, 0.025, dest, 0.12 * G, { type: 'highpass', f: 3000 });
      fm(ctx, mtof(n0), t0 + 0.03, 0.08, dest, 0.08 * G, { ratio: 2, index: 1.5, idxDecay: 0.05 });
      fm(ctx, mtof(up(notes, reg, pitchIndex, 2)), t0 + 0.12, 0.1, dest, 0.08 * G, { ratio: 2, index: 1.5, idxDecay: 0.05 });
      return t0 + 0.24;
    case 'ix-db':
      osc(ctx, 'sine', mtof(n0 + 12), t0, 0.12, dest, 0.1 * G, { freqEnd: mtof(n0), attack: 0.005 });
      osc(ctx, 'sine', mtof(n0 + 7), t0 + 0.07, 0.1, dest, 0.05 * G, { freqEnd: mtof(n0 - 5) });
      return t0 + 0.2;
    case 'ix-fan':
      for (let i = 0; i < 3; i++) noise(ctx, t0 + i * 0.08, 0.1, dest, 0.12 * G, { type: 'bandpass', f: 900 + i * 700, q: 3, attack: 0.01 });
      return t0 + 0.3;
    case 'ix-batch':
      fm(ctx, mtof(noteFor(notes, 'high', 0)), t0, 0.22, dest, 0.09 * G, { ratio: 3, index: 1.0, idxDecay: 0.12 });
      fm(ctx, mtof(noteFor(notes, 'high', 2)), t0 + 0.1, 0.22, dest, 0.08 * G, { ratio: 3, index: 1.0, idxDecay: 0.12 });
      return t0 + 0.34;
    case 'ix-chime': {
      const r = noteFor(notes, 'high', 0);
      osc(ctx, 'sine', mtof(r), t0, 0.26, dest, 0.13 * G, { attack: 0.02 });
      osc(ctx, 'sine', semis(r, 7), t0 + 0.12, 0.26, dest, 0.11 * G, { attack: 0.02 });
      osc(ctx, 'triangle', mtof(r - 12), t0, 0.3, dest, 0.03 * G, { attack: 0.03 });
      return t0 + 0.4;
    }
    case 'ix-ping':
      osc(ctx, 'sine', mtof(noteFor(notes, 'high', 4) + 12), t0, 0.1, dest, 0.05 * G, { attack: 0.006 });
      return t0 + 0.14;
    case 'ix-stamp':
      noise(ctx, t0, 0.03, dest, 0.1 * G, { type: 'bandpass', f: 1400, q: 1.5 });
      osc(ctx, 'sine', mtof(n0), t0, 0.05, dest, 0.06 * G);
      return t0 + 0.08;
    // ---- 작업 대상 상호작용 ----
    case 'act-build': {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.connect(dest);
      osc(ctx, 'triangle', mtof(n0 + 12), t0, 0.09, lp, 0.22 * G, { attack: 0.004 });
      osc(ctx, 'triangle', semis(n0 + 12, 7), t0 + 0.11, 0.12, lp, 0.2 * G, { attack: 0.004 });
      noise(ctx, t0 + 0.1, 0.12, dest, 0.05 * G, { type: 'lowpass', f: 500 });
      return t0 + 0.3;
    }
    case 'act-crumble':
      for (let i = 0; i < 3; i++) noise(ctx, t0 + i * 0.07, 0.12, dest, (0.12 - i * 0.025) * G, { type: 'bandpass', f: 1600 - i * 450, fEnd: 400, q: 1.2, attack: 0.006 });
      return t0 + 0.34;
    case 'act-flash':
      noise(ctx, t0, 0.03, dest, 0.12 * G, { type: 'highpass', f: 5000 });
      osc(ctx, 'sine', mtof(noteFor(notes, 'high', pitchIndex) + 12), t0 + 0.03, 0.2, dest, 0.05 * G, { attack: 0.005 });
      return t0 + 0.26;
    default:
      return t0;
  }
}

// ───────────────────────── 버스·음성 관리 ─────────────────────────
export const MAX_VOICES = 6;
const KEY = 'ccviz.sfx';

/** 재생 장치와 무관한 버스 연결: voice → sfxBus(volume×0.6, 음악 켜지면 −3dB) → compressor → destination */
export function createBus(ctx, volume = 0.5) {
  const bus = ctx.createGain();
  bus.gain.value = volume * 0.6;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12;
  bus.connect(comp); comp.connect(ctx.destination);
  return { bus, comp };
}

export class Sfx {
  constructor({ getMusicTime = () => null, storage, AudioCtx } = {}) {
    this.getMusicTime = getMusicTime;
    this._storage = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this._AudioCtx = AudioCtx || (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);
    this.ctx = null;
    this._bus = null;
    this._on = false;
    this._vol = 0.5;
    this.wantOn = false;
    this.limiter = new RateLimiter();
    this.voices = [];  // {g, priority, start, end}
    this.stats = { played: 0, dropped: 0, stolen: 0 };
    try {
      const s = JSON.parse((this._storage && this._storage.getItem(KEY)) || 'null');
      if (s && typeof s.volume === 'number') this._vol = Math.max(0, Math.min(1, s.volume));
      if (s && s.on) this.wantOn = true;
    } catch (e) { /* 저장소 없음 */ }
  }
  get enabled() { return this._on; }
  get volume() { return this._vol; }

  _ensure() {
    if (this.ctx || !this._AudioCtx) return !!this.ctx;
    try {
      this.ctx = new this._AudioCtx({ latencyHint: 'interactive' });
      this._bus = createBus(this.ctx, this._vol);
    } catch (e) { this.ctx = null; return false; }
    return true;
  }
  setEnabled(on) {
    this._on = !!on;
    this.wantOn = this._on;
    if (this._on && this._ensure() && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this._on && this.ctx) { for (const v of this.voices) this._kill(v, 0.02); this.voices = []; }
    this._save();
  }
  /** 시각화 일시정지: 켜짐 설정은 그대로 두고 소리만 막음(울리던 소리는 짧게 끊음). 저장하지 않는다 */
  setHold(on) {
    this.held = !!on;
    if (this.held && this.ctx) { for (const v of this.voices) this._kill(v, 0.05); this.voices = []; }
  }
  setVolume(v) {
    this._vol = Math.max(0, Math.min(1, Number(v) || 0));
    this._applyGain();
    this._save();
  }
  _applyGain() {
    if (!this._bus) return;
    let musicOn = false;
    try { musicOn = this.getMusicTime() != null; } catch (e) {}
    const target = this._vol * 0.6 * (musicOn ? 0.708 : 1);
    const g = this._bus.bus.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(target, this.ctx.currentTime, 0.03);
  }
  _save() { try { this._storage && this._storage.setItem(KEY, JSON.stringify({ on: this._on, volume: this._vol })); } catch (e) {} }

  onEvent(ev, { node = null, speed = 1, quiet = false, replay = false } = {}) {
    if (!this._on || quiet || this.held) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    // 컨텍스트가 멈춘 동안(자동재생 대기·interrupted)은 쌓지 않는다 — 풀리면 한꺼번에 나므로(복원은 sound.mjs)
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== undefined) { this.ctx.resume().catch(() => {}); return false; }
    const s = eventToSound(ev, node);
    if (!s) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this.limiter.allow(s, now, replay ? speed : 1)) { this.stats.dropped++; return false; }
    return this.play(s.name, s);
  }

  play(name, { priority = 2, pitchIndex = 0, pan = 0, gain = 1 } = {}) {
    if (!SOUNDS[name] || this.held || !this._ensure()) return false;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= MAX_VOICES) {
      // 가장 낮은 우선순위(큰 숫자) 중 가장 오래된 것
      let victim = null;
      for (const v of this.voices) if (!victim || v.priority > victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      if (priority !== 0 && victim.priority < priority) { this.stats.dropped++; return false; }
      this._kill(victim, 0.02);
      this.voices = this.voices.filter((v) => v !== victim);
      this.stats.stolen++;
    }
    this._applyGain();
    const vg = ctx.createGain();
    vg.gain.value = 1;
    let out = vg;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); vg.connect(p); p.connect(this._bus.bus); }
    else vg.connect(this._bus.bus);
    let musicT = null;
    try { musicT = this.getMusicTime(); } catch (e) {}
    const t0 = now + 0.01;
    const end = synth(ctx, out, name, t0, { notes: scaleNotes(musicT), pitchIndex, gain });
    const v = { g: vg, priority, start: t0, end: end + 0.05 };
    this.voices.push(v);
    setTimeout(() => { try { vg.disconnect(); } catch (e) {} }, (end - now + 0.3) * 1000);
    this.stats.played++;
    return true;
  }

  _kill(v, fade) {
    try {
      const t = this.ctx.currentTime;
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0, t + fade);
    } catch (e) {}
    v.end = 0;
  }

  /**
   * 버튼·볼륨 슬라이더 연결 도우미(replay/dev.html 용. 본 앱은 sound.mjs 소리 토글이 음악과 함께 켜고 끈다). 문구 "효과음 꺼짐/켜짐", 저장값 on 이면 첫 사용자 동작 때 켠다.
   */
  bindControls({ button, slider } = {}) {
    const label = () => { if (button) { button.textContent = tr(this._on ? 'sound.sfx.on' : 'sound.sfx.off'); button.setAttribute('aria-pressed', String(this._on)); } };
    if (!this._AudioCtx && button) { button.disabled = true; button.title = tr('sound.sfx.noWebAudio'); }
    if (button) {
      button.title = button.title || tr('sound.sfx.title');
      button.addEventListener('click', () => { this.setEnabled(!this._on); label(); if (this._on) this.play('chime', { priority: 0 }); });
    }
    if (slider) {
      slider.value = String(this._vol);
      slider.addEventListener('input', () => this.setVolume(slider.value));
    }
    if (this.wantOn && typeof window !== 'undefined') {
      if (button) button.textContent = tr('sound.sfx.pending');
      const once = () => { window.removeEventListener('pointerdown', once, true); window.removeEventListener('keydown', once, true); if (!this._on) { this.setEnabled(true); label(); } };
      window.addEventListener('pointerdown', once, true);
      window.addEventListener('keydown', once, true);
    } else label();
    return { refresh: label };
  }

  dispose() {
    this._on = false;
    for (const v of this.voices) this._kill(v, 0.02);
    this.voices = [];
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} }
    this.ctx = null; this._bus = null;
  }
}
