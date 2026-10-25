// 작업 대상 상호작용 연출 — 순수 부분(three·DOM·다른 모듈 import 없음, node --test 대상).
//
// 에이전트 노드와 바닥 작업 대상(파일·산출물·저장소·DB·원격·서비스) 사이에 동사 × 대상 종류마다 알아볼 수 있는 짧은 연출(1～3초).
//   읽기 = 스캔 빛줄기가 훑고 글자 조각이 떠올라 노드로 빨려 듦 · 쓰기 시작 = 조각이 날아감 · 생성 = 층층이 쌓여 솟음(건설)
//   편집 = 커서·하이라이트 줄, 지운 조각이 흩어지고 새 줄이 끼워짐 · 삭제 = 부서져 흩어지고 땅으로 꺼짐
//   검색(Grep·Glob) = 레이더·탐조등이 훑고 걸린 파일(결과 경로가 장부 대상과 맞는 것만)이 핑 · DB 조회 = 데이터 방울이 퐁퐁, DB 쓰기 = 방울이 떨어져 물결
//   push = 상자가 포장돼 쏘아 올려짐 · pull·fetch·clone = 상자가 떨어져 내려앉음 · 커밋 = 도장 · 원격 조회 = 끈을 따라 핑 왕복
//   서비스·웹 = 안테나 신호파 · 산출물 = 사진 찍히듯 플래시 · 실패 = 빨간 스파크로 튕겨 나옴 · 중지됨 = 회색으로 가라앉음
// 표현마다 은유만 바꾼다(theme): flow = 빛·입자·데이터 조각, planet = 드론·우주선·로켓·크레인, voxel = 서류·택배·도장·손전등.
// 큐(ArtActs)는 동시 상한·같은 대상 합치기·배속 압축을 맡고, 그리기(drawActs)는 표현의 도형 함수가 끝에 부른다(ArtGeo 버퍼 그대로 → 3D·2D 공용).

export const ACT = {
  MAX_LIVE: 10,        // 동시에 살아 있는 연출 상한(넘치면 덜 중요한 것부터 밀어냄)
  FAST_LIVE: 6,        // 배속 ≥ 8 이면 상한을 더 줄임
  MERGE_S: 0.7,        // 같은 대상 · 같은 연출이 이 안에 또 오면 합침(조각 수 +1, 조금 길게)
  N_MAX: 5,            // 합친 횟수 상한(조각 수)
  PENDING_MAX: 200,    // 끝을 기다리는 도구 호출(실패·중지 연출용)
  PENDING_TTL_S: 120,
  HITS_MAX: 6,         // 검색 핑 상한
  SOUND_GAP_S: 0.35,   // 연출 효과음 최소 간격
  MIN_DUR: 0.45,       // 배속 압축 하한(초)
};
export const ACT_DUR = {
  read: 1.5, carry: 0.9, build: 1.7, edit: 1.6, shatter: 1.6, radar: 1.8, ping: 1.0, bubbles: 1.7, pour: 1.5,
  pack: 0.8, launch: 1.8, drop: 1.4, stamp: 1.0, signal: 1.5, flash: 1.3, fail: 1.2, stop: 1.3, web: 1.5, tether: 1.4,
};
export const ACT_NAMES = Object.keys(ACT_DUR);
/** 중요도(작을수록 중요 — 상한에서 끝까지 남음) */
export const ACT_PRI = { fail: 0, shatter: 0, stop: 1, build: 1, launch: 1, flash: 1, edit: 2, pour: 2, drop: 2, stamp: 2, radar: 2, signal: 3, bubbles: 3, read: 3, tether: 3, carry: 4, pack: 4, ping: 4, web: 4 };
/** 배속 ≥ 8 이면 건너뛰는 잔연출(시작 쪽·부수) */
const MINOR = new Set(['carry', 'pack', 'ping', 'web', 'tether']);
/** 쿨다운(초): 레이더 = 섬마다, 웹 = 노드마다 */
const COOL = { radar: 6, web: 6 };
/** 연출 이름 → 색 열쇠(ART_KEYS) */
export const ACT_COLOR = {
  read: 'read', carry: 'write', build: 'new', edit: 'write', shatter: 'del', radar: 'read', ping: 'read', bubbles: 'read', pour: 'write',
  pack: 'write', launch: 'write', drop: 'read', stamp: 'write', signal: 'write', flash: 'new', fail: 'alarm', stop: 'del', web: 'read', tether: 'read',
};

/**
 * 대상 참조(ref = {k, v, …}) · 단계 → 연출 이름(없으면 null).
 * start = 도구 시작(입력으로 추정한 대상), end = 성공한 끝(결과로 다듬은 대상).
 */
export function actOf(ref, phase) {
  if (!ref) return null;
  const k = ref.k, v = ref.v;
  if (phase === 'start') {
    if (k === 'file' || k === 'output') return v === 'read' || v === 'query' ? 'read' : v === 'delete' ? null : 'carry';
    if (k === 'db') return v === 'read' || v === 'query' ? 'bubbles' : null;
    if (k === 'service') return 'signal';
    if (k === 'remote') return v === 'query' ? 'tether' : v === 'write' || v === 'push' ? 'pack' : null;
    if (k === 'repo') return v === 'push' ? 'pack' : v === 'query' ? 'ping' : null;
    return null;
  }
  if (k === 'file' || k === 'output') {
    if (v === 'delete') return 'shatter';
    if (v === 'create') return k === 'output' ? 'flash' : 'build';
    if (v === 'modify' || v === 'write') return k === 'output' ? 'flash' : 'edit';
    return null;
  }
  if (k === 'db') return v === 'delete' ? 'shatter' : v === 'write' || v === 'create' || v === 'modify' ? 'pour' : null;
  if (k === 'repo') return v === 'push' ? 'launch' : v === 'write' ? 'stamp' : v === 'read' ? 'drop' : null;
  if (k === 'remote') return v === 'write' || v === 'push' ? 'launch' : v === 'read' ? 'drop' : null;
  return null; // 서비스는 시작 때 신호파로 끝
}
/** 연출 → 효과음 이름(기존 도구·특별 상호작용 소리와 겹치지 않는 '착지' 순간만), 없으면 null */
export function actSound(a) {
  return a === 'build' ? 'act-build' : a === 'shatter' ? 'act-crumble' : a === 'flash' ? 'act-flash' : null;
}
/** 중단·거부로 끝났나(회색 '중지됨' 연출) */
export const isInterrupt = (ev) => !!ev && (/interrupt|중단|중지|취소|cancel|rejected|거부|denied/i.test(String(ev.brief || ev.text || '').slice(0, 200)) || (ev.ix && (ev.ix.op === 'deny' || ev.ix.op === 'interrupt')));

/** 검색 결과 줄(패널 lines, 'h' 표시) → 경로 꼬리(소문자, '…/' 와 줄 번호 뗌) */
export function hitPaths(panel, max = 11) {
  if (!panel || !Array.isArray(panel.lines)) return [];
  const marks = String(panel.marks || '');
  const out = [];
  for (let i = 0; i < panel.lines.length && out.length < max; i++) {
    if (marks && marks[i] && marks[i] !== 'h') continue;
    let s = String(panel.lines[i] || '').trim();
    if (!s) continue;
    s = s.replace(/^…[\\/]/, '').replace(/:\d+([:-].*)?$/, '').replace(/\\/g, '/').toLowerCase();
    if (!/[./]/.test(s) || s.length < 3) continue;
    out.push(s);
  }
  return out;
}
/** 경로 꼬리들 ↔ 장부 대상(파일·산출물): id·표시 경로가 그 꼬리로 끝나는 것(최대 max) */
export function matchHits(items, tails, max = ACT.HITS_MAX) {
  const out = [];
  if (!tails.length) return out;
  for (const it of items) {
    if (out.length >= max) break;
    if (it.k !== 'file' && it.k !== 'output') continue;
    const id = String(it.id || '').toLowerCase(), p = String(it.p || '').replace(/\\/g, '/').toLowerCase();
    for (const t of tails) {
      if (id === t || p === t || id.endsWith('/' + t) || p.endsWith('/' + t) || t.endsWith('/' + id) || (t.length > 6 && (id.endsWith(t) || p.endsWith(t)))) { out.push(it.id); break; }
    }
  }
  return out;
}

/**
 * 연출 큐. 시계 = 렌더러 초(performance.now()/1000). 항목:
 * {a, pid, id(없으면 노드·구역 기준), node, t0, dur, n(합친 수), k(대상 종류), sz, tu, v}
 */
export class ArtActs {
  constructor() {
    this.list = [];
    this.pending = new Map();   // toolUseId → {pid, node, refs:[{id,k,v}], t}
    this.sounds = [];           // 앱이 꺼내 울릴 소리 이름
    this._soundAt = -1e9;
    this.version = 0;
    this.stats = { added: 0, merged: 0, dropped: 0, replaced: 0 };
    this._keys = null; this._keysVer = -1;
    this._cool = new Map();
  }
  clear() { this.list.length = 0; this.pending.clear(); this.sounds.length = 0; this._cool.clear(); this.version++; }
  get active() { return this.list.length > 0; }
  step(nowSec) {
    if (!this.list.length) return;
    const n0 = this.list.length;
    this.list = this.list.filter((e) => nowSec - e.t0 < e.dur);
    if (this.list.length !== n0) this.version++;
  }
  /**
   * 하나 더하기(합치기·상한·배속 압축). 반환 = 들어간(또는 합쳐진) 항목 | null
   * o = {a, pid, id, node, k, sz, tu, v, delay}
   */
  add(o, nowSec, speed = 1) {
    const a = o.a;
    if (!ACT_DUR[a]) return null;
    const sp = Math.max(1, speed || 1);
    if (sp >= 8 && MINOR.has(a)) { this.stats.dropped++; return null; }
    const base = Math.max(ACT.MIN_DUR, ACT_DUR[a] / Math.sqrt(sp));
    const t0 = nowSec + (o.delay || 0) / Math.sqrt(sp);
    if (COOL[a]) { // 검색·웹은 아주 잦다: 섬(레이더)·노드(웹)마다 쿨다운 안이면 버림 — 바닥층이 늘 번쩍이지 않게
      const ck = a + '|' + (a === 'radar' ? o.pid : o.node);
      const last = this._cool.get(ck);
      if (last != null && t0 - last < COOL[a]) { this.stats.dropped++; return null; }
      this._cool.set(ck, t0);
      if (this._cool.size > 256) this._cool.delete(this._cool.keys().next().value);
    }
    for (const e of this.list) {
      if (e.a === a && e.pid === o.pid && e.id === (o.id ?? null) && (a !== 'radar' || e.node === (o.node || null)) && t0 - e.t0 < ACT.MERGE_S && t0 >= e.t0 - 0.05) {
        if (e.n < ACT.N_MAX) e.n++;
        e.dur = Math.min(e.base * 1.6, e.dur + e.base * 0.2);
        if (o.sz) e.sz = (e.sz || 0) + o.sz;
        this.stats.merged++; this.version++;
        return e;
      }
    }
    const cap = sp >= 8 ? ACT.FAST_LIVE : ACT.MAX_LIVE;
    const pri = ACT_PRI[a] ?? 3;
    if (this.list.length >= cap) {
      let vi = -1;
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i], pe = ACT_PRI[e.a] ?? 3;
        if (vi < 0) { vi = i; continue; }
        const pv = ACT_PRI[this.list[vi].a] ?? 3;
        if (pe > pv || (pe === pv && e.t0 < this.list[vi].t0)) vi = i;
      }
      if (vi < 0 || (ACT_PRI[this.list[vi].a] ?? 3) < pri) { this.stats.dropped++; return null; }
      this.list.splice(vi, 1); this.stats.replaced++;
    }
    const e = { a, pid: o.pid, id: o.id ?? null, node: o.node || null, k: o.k || null, sz: o.sz || 0, tu: o.tu || null, v: o.v || null, t0, dur: base, base, n: 1 };
    this.list.push(e);
    this.stats.added++; this.version++;
    const s = actSound(a);
    if (s && sp <= 4 && nowSec - this._soundAt >= ACT.SOUND_GAP_S) { this._soundAt = nowSec; this.sounds.push(s); if (this.sounds.length > 4) this.sounds.shift(); }
    return e;
  }
  /** 장부 반영 결과(ArtBook.apply) → 연출. tu = toolUseId(실패·중지 짝짓기) */
  fromRes(res, node, nowSec, speed = 1, tu = null) {
    if (!res) return;
    const pid = res.pid;
    if (res.start) {
      const refs = [];
      for (const ch of res.changes) {
        const ref = ch.ref;
        refs.push({ id: ref.id, k: ref.k, v: ref.v });
        if (!ch.item && (ref.v === 'read' || ref.v === 'query')) continue; // 장부에 없는 대상 읽기는 연출 없음
        const a = actOf(ref, 'start');
        if (a) this.add({ a, pid, id: ref.id, node, k: ref.k, v: ref.v, tu }, nowSec, speed);
      }
      if (tu) this._pend(tu, { pid, node, refs, t: nowSec });
      return;
    }
    const started = tu && this.pending.get(tu);
    if (tu) this.pending.delete(tu);
    let q = 0;
    for (const ch of res.changes) {
      const ref = ch.ref;
      // 시작 때 대상을 몰랐던 호출(끝에만 art)은 시작 연출도 같이(읽기·조회·신호)
      if (!started || !started.refs.some((r) => r.id === ref.id)) { const s = actOf(ref, 'start'); if (s && s !== 'carry' && s !== 'pack') this.add({ a: s, pid, id: ref.id, node, k: ref.k, v: ref.v, tu }, nowSec, speed); }
      const a = actOf(ref, 'end');
      if (a) this.add({ a, pid, id: ref.id, node, k: ref.k, v: ref.v, sz: ref.sz || 0, tu, delay: Math.min(0.3, q++ * 0.08) }, nowSec, speed);
    }
  }
  _pend(tu, rec) {
    this.pending.set(tu, rec);
    if (this.pending.size > ACT.PENDING_MAX) { const k = this.pending.keys().next().value; this.pending.delete(k); }
  }
  /** 실패한 끝(ok:false, art 없음) — 시작 때 대상이 있던 호출만: 빨간 스파크(실패) · 회색(중단·거부) */
  fail(ev, nowSec, speed = 1) {
    const p = ev && ev.toolUseId ? this.pending.get(ev.toolUseId) : null;
    if (!p) return 0;
    this.pending.delete(ev.toolUseId);
    const a = isInterrupt(ev) ? 'stop' : 'fail';
    let n = 0;
    for (const r of p.refs.slice(0, 3)) if (this.add({ a, pid: p.pid, id: r.id, node: p.node, k: r.k, v: r.v, tu: ev.toolUseId }, nowSec, speed)) n++;
    return n;
  }
  /** 노드가 중지됨(node-update stopped) — 그 노드가 끝을 기다리던 호출 대상은 회색으로 */
  nodeStopped(nodeId, nowSec, speed = 1) {
    let n = 0;
    for (const [tu, p] of [...this.pending]) {
      if (p.node !== nodeId) continue;
      this.pending.delete(tu);
      for (const r of p.refs.slice(0, 2)) if (this.add({ a: 'stop', pid: p.pid, id: r.id, node: nodeId, k: r.k, v: r.v, tu }, nowSec, speed)) n++;
    }
    return n;
  }
  /** 검색 도구: 시작 = 레이더(그 노드 섬 바닥), 끝(성공) = 결과 경로가 장부 대상과 맞는 것만 핑 */
  search(ev, pid, items, nowSec, speed = 1) {
    if (!ev) return 0;
    if (ev.type === 'tool-start') return this.add({ a: 'radar', pid, id: null, node: ev.nodeId, tu: ev.toolUseId }, nowSec, speed) ? 1 : 0;
    if (ev.type !== 'tool-end' || ev.ok === false) return 0;
    const ids = matchHits(items || [], hitPaths(ev.panel));
    let n = 0;
    ids.forEach((id, q) => { if (this.add({ a: 'ping', pid, id, node: ev.nodeId, k: 'file', tu: ev.toolUseId, delay: q * 0.09 }, nowSec, speed)) n++; });
    return n;
  }
  /** 웹 도구(WebFetch·WebSearch) 시작: 노드에서 안테나 신호파(바닥 대상 없음) */
  web(ev, pid, nowSec, speed = 1) { return this.add({ a: 'web', pid, id: null, node: ev.nodeId, tu: ev.toolUseId }, nowSec, speed) ? 1 : 0; }
  /**
   * 그리기에 필요한 대상 열쇠 'pid|id'(위치를 기록할 것) — 구역 묶음 배치면 zoneOf(item) 열쇠도.
   * book.get(pid, id) 로 항목을 찾는다. 바뀔 때만 다시 만든다.
   */
  keys(book, zoneOf = null) {
    if (this._keys && this._keysVer === this.version) return this._keys;
    const s = new Set();
    for (const e of this.list) {
      if (e.id == null) continue;
      s.add(e.pid + '|' + e.id);
      if (zoneOf && book) { const it = book.get(e.pid, e.id); if (it) s.add(e.pid + '|' + zoneOf(it)); }
    }
    this._keys = s; this._keysVer = this.version;
    return s;
  }
}

// ───────────── 위치 기록(표현 도형 함수가 대상마다 채움) ─────────────
/** 대상 기준점: {x, y(빔 끝), z, top(꼭대기), Y0(바닥), C(크기), ox,oz(바깥 방향), fx,fz(앞 방향)} — 프레임마다 재사용 */
export class ActPos {
  constructor() { this.m = new Map(); this.pool = []; this.n = 0; this.areas = new Map(); }
  begin() { this.m.clear(); this.n = 0; this.areas.clear(); }
  put(key, x, y, z, top, Y0, C) {
    let r = this.pool[this.n]; if (!r) { r = {}; this.pool[this.n] = r; }
    this.n++;
    r.x = x; r.y = y; r.z = z; r.top = top; r.Y0 = Y0; r.C = C; r.ox = 0; r.oz = 0; r.fx = 0; r.fz = 1;
    this.m.set(key, r);
    return r;
  }
  get(key) { return this.m.get(key) || null; }
}

// ───────────── 그리기 ─────────────
const TAU = Math.PI * 2;
const cl = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k);
const easeOut = (k) => 1 - Math.pow(1 - cl(k), 3);
const easeIn = (k) => cl(k) * cl(k);
const seg = (k, a, b) => cl((k - a) / (b - a)); // k 를 [a,b] 구간 진행도로
const fade = (k, a = 0.75) => (k < a ? 1 : 1 - (k - a) / (1 - a));
/** 화면 크기 보정(멀리서 봐도 조각·고리가 보이게): 1 세계 단위가 16px 보다 작으면 입자·고리·높이를 키움(1～4) */
let S = 1;
export const actScale = (unitPx) => (Number.isFinite(unitPx) && unitPx > 0 ? Math.max(1, Math.min(4, 16 / unitPx)) : 1);
const dot = (geo, x, y, z, s, c, a) => geo.dot(x, y, z, s * S, c, a);
const P0 = { x: 0, y: 0, z: 0 }, P1 = { x: 0, y: 0, z: 0 }, P2 = { x: 0, y: 0, z: 0 }, PN = { x: 0, y: 0, z: 0 };
/** a → b 포물선(가운데가 lift 만큼 높음) 위 u 지점 */
function arcTo(o, a, b, u, lift) { o.x = a.x + (b.x - a.x) * u; o.y = a.y + (b.y - a.y) * u + Math.sin(Math.PI * u) * lift * S; o.z = a.z + (b.z - a.z) * u; return o; }
function dirXZ(a, b) { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; }
const hash = (s) => { let h = 2166136261 >>> 0; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

/** 데이터 조각(테마별): flow = 글자 줄 두 토막 + 작은 빛점, planet = 작은 우주선(세모), voxel = 서류 한 장 */
function frag(geo, th, x, y, z, dx, dz, c, a, s = 1) {
  if (a <= 0.01) return;
  s *= S;
  if (th === 'voxel') { geo.box(x, y, z, 0.3 * s, 0.03, 0.22 * s, c, Math.min(1, a), null); return; }
  if (th === 'planet') {
    const px = -dz, pz = dx, L = 0.42 * s;
    const nx = x + dx * L, nz = z + dz * L, bx = x - dx * L * 0.6, bz = z - dz * L * 0.6;
    geo.line(nx, y, nz, bx + px * L * 0.55, y, bz + pz * L * 0.55, c, a); geo.line(nx, y, nz, bx - px * L * 0.55, y, bz - pz * L * 0.55, c, a);
    geo.line(bx + px * L * 0.55, y, bz + pz * L * 0.55, bx - px * L * 0.55, y, bz - pz * L * 0.55, c, a * 0.8);
    geo.dot(x - dx * L * 0.85, y, z - dz * L * 0.85, 0.12 * s, c, a * 0.8); // 엔진 불빛
    return;
  }
  const px = -dz, pz = dx, L = 0.32 * s;
  geo.line(x - px * L, y, z - pz * L, x + px * L, y, z + pz * L, c, a);
  geo.line(x - px * L, y - 0.13 * s, z - pz * L, x + px * L * 0.3, y - 0.13 * s, z + pz * L * 0.3, c, a * 0.7);
  geo.dot(x, y, z, 0.13 * s, c, a * 0.6);
}
/** 상자 모서리 12 */
function cube(geo, x, y, z, h, c, a, edges = 12) {
  h *= S;
  const E = [[-1, -1, -1, 1, -1, -1], [1, -1, -1, 1, -1, 1], [1, -1, 1, -1, -1, 1], [-1, -1, 1, -1, -1, -1], [-1, -1, -1, -1, 1, -1], [1, -1, -1, 1, 1, -1], [1, -1, 1, 1, 1, 1], [-1, -1, 1, -1, 1, 1], [-1, 1, -1, 1, 1, -1], [1, 1, -1, 1, 1, 1], [1, 1, 1, -1, 1, 1], [-1, 1, 1, -1, 1, -1]];
  for (let i = 0; i < Math.min(12, edges); i++) { const e = E[i]; geo.line(x + e[0] * h, y + e[1] * h, z + e[2] * h, x + e[3] * h, y + e[4] * h, z + e[5] * h, c, a); }
}
/** 택배·데이터 꾸러미(테마별): flow = 와이어 큐브, planet = 로켓, voxel = 테이프 붙인 상자 */
function parcel(geo, th, x, y, z, s, c, a, exhaust = 0) {
  if (a <= 0.01) return;
  s *= S;
  if (th === 'planet') {
    const w = 0.18 * s, H = 1.1 * s;
    geo.line(x - w, y, z, x - w, y + H * 0.7, z, c, a); geo.line(x + w, y, z, x + w, y + H * 0.7, z, c, a);
    geo.line(x - w, y + H * 0.7, z, x, y + H, z, c, a); geo.line(x + w, y + H * 0.7, z, x, y + H, z, c, a);
    geo.line(x - w, y, z, x - w * 2, y - 0.15 * s, z, c, a * 0.8); geo.line(x + w, y, z, x + w * 2, y - 0.15 * s, z, c, a * 0.8);
    geo.line(x, y, z - w, x, y + H * 0.7, z - w, c, a * 0.5);
    if (exhaust > 0) for (let q = 0; q < 3; q++) geo.dot(x + (q - 1) * 0.1 * s, y - 0.2 - q * 0.3 * exhaust, z, 0.16 * s, c, a * 0.7 * (1 - q / 3));
    return;
  }
  const h = 0.3 * s;
  if (th === 'voxel') {
    geo.box(x, y, z, h * 2, h * 2, h * 2, c, Math.min(1, a * 0.9), null);
    geo.line(x - h, y + h + 0.01, z, x + h, y + h + 0.01, z, c, a); geo.line(x, y + h + 0.01, z - h, x, y + h + 0.01, z + h, c, a); // 테이프 십자
    return;
  }
  cube(geo, x, y, z, h, c, a);
  if (exhaust > 0) geo.dot(x, y - h - 0.25 * exhaust, z, 0.14 * s, c, a * 0.6);
}
/** 바닥 고리 파문 */
function ripple(geo, x, y, z, r, c, a, segs = 22) { r *= S; if (a > 0.01 && r > 0.01) geo.ring(x, y, z, r, c, a, segs); }

/**
 * 연출 그리기. acts = ArtActs, ctx = { theme, KI(색 열쇠 → 번호), pos(ActPos), zoneOf(item)|null, book, nodePos(id), reduced, isLight, pidAlpha(pid)|null }
 * pidAlpha = 그 프로젝트의 페이드 투명도 — 장면마다 geo.ka 로 곱하고(0 이면 건너뜀) 끝나면 1 로 되돌린다.
 * 대상 위치는 표현 도형 함수가 같은 프레임에 ActPos 에 남긴 것(없는 대상 — 넘친 복셀 칸 등 — 은 건너뜀).
 */
export function drawActs(geo, acts, nowSec, ctx) {
  if (!acts || !acts.list.length) return 0;
  const th = ctx.theme || 'flow', KI = ctx.KI, pos = ctx.pos;
  let drawn = 0;
  for (const e of acts.list) {
    const k = (nowSec - e.t0) / e.dur;
    if (k < 0 || k >= 1) continue;
    const ka = ctx.pidAlpha ? ctx.pidAlpha(e.pid) : 1; // 프로젝트 페이드
    if (!(ka > 0)) continue;
    geo.ka = ka;
    const c = KI[ACT_COLOR[e.a]] ?? 0;
    let T = null;
    if (e.id != null) {
      T = pos.get(e.pid + '|' + e.id);
      if (!T && ctx.zoneOf && ctx.book) { const it = ctx.book.get(e.pid, e.id); if (it) T = pos.get(e.pid + '|' + ctx.zoneOf(it)); }
      if (!T) continue;
    }
    const np = e.node && ctx.nodePos ? ctx.nodePos(e.node) : null;
    let N = null;
    if (np) { PN.x = np.x; PN.y = np.y; PN.z = np.z; N = PN; }
    const area = e.id == null ? pos.areas.get(e.pid) || null : null;
    if (e.id == null && !area && !N) continue;
    S = ctx.unitPx ? actScale(ctx.unitPx(e.pid)) : 1;
    if (ctx.reduced) { reducedAct(geo, e, k, T, N, area, c, KI); drawn++; continue; }
    if (!N && T) { PN.x = T.x; PN.y = T.top + 6; PN.z = T.z; N = PN; } // 노드가 화면에 없으면 '하늘'에서
    S = ctx.unitPx ? actScale(ctx.unitPx(e.pid)) : 1;
    const fn = DRAW[e.a];
    if (fn) { fn(geo, th, e, k, T, N, area, c, KI); drawn++; }
  }
  geo.ka = 1;
  return drawn;
}
/** 움직임 줄이기: 단순 페이드(대상 둘레 고리·윤곽만 밝아졌다 사라짐) */
function reducedAct(geo, e, k, T, N, area, c, KI) {
  const a = 0.7 * (1 - k);
  if (T) { ripple(geo, T.x, T.top + 0.03, T.z, T.C * 0.55, c, a, 18); return; }
  const p = area || N;
  ripple(geo, p.x, (area ? area.y : N.y) + 0.03, p.z, area ? Math.min(area.r, 4) : 1.2, c, a * 0.8, 20);
}

const DRAW = {
  // 읽기: 스캔 빛줄기가 대상 윗면을 훑고, 글자 조각이 떠올라 노드로 빨려 듦
  read(geo, th, e, k, T, N, _a, c) {
    const w = Math.max(0.25, T.C * 0.42), n = Math.min(5, 2 + e.n);
    if (th === 'planet') { // 우주선이 내려와 맴돌며 견인 광선, 화물이 떠올라 실림 → 돌아감
      P0.x = T.x; P0.y = T.top + 2.0 * S; P0.z = T.z;
      let s;
      if (k < 0.25) s = arcTo(P1, N, P0, easeOut(k / 0.25), 0.8); else if (k > 0.78) s = arcTo(P1, P0, N, easeIn((k - 0.78) / 0.22), 0.8); else { P1.x = P0.x + Math.sin(k * 20) * 0.05; P1.y = P0.y; P1.z = P0.z; s = P1; }
      const [dx, dz] = k > 0.78 ? dirXZ(P0, N) : dirXZ(N, P0);
      frag(geo, th, s.x, s.y, s.z, dx, dz, c, 0.95, 1.6);
      const b = seg(k, 0.25, 0.78);
      if (b > 0 && b < 1) {
        const ba = 0.45 * Math.sin(b * Math.PI);
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) geo.line(s.x, s.y, s.z, T.x + sx * w, T.top, T.z + sz * w, c, ba);
        const ry = s.y - (s.y - T.top) * ((b * 2.2) % 1);
        ripple(geo, T.x, ry, T.z, w * (0.3 + 0.7 * ((ry - s.y) / (T.top - s.y || 1))), c, ba * 1.2, 14);
        for (let q = 0; q < n; q++) { const u = seg(b, q * 0.12, q * 0.12 + 0.55); if (u > 0 && u < 1) dot(geo, T.x + (q - n / 2) * 0.12, T.top + (s.y - T.top) * easeIn(u), T.z, 0.14, c, 0.9); }
      }
      return;
    }
    if (th === 'voxel') { // 서랍에서 서류를 꺼내(앞으로 빼고) 직원에게 날아감, 칸 앞에 손전등 둥근 빛
      ripple(geo, T.x + T.fx * 0.05, T.y, T.z + T.fz * 0.05, 0.22 + 0.1 * Math.sin(k * 12), c, 0.6 * fade(k, 0.4), 14);
      for (let q = 0; q < n; q++) {
        const u = seg(k, q * 0.1, q * 0.1 + 0.75);
        if (u <= 0 || u >= 1) continue;
        P0.x = T.x + T.fx * 0.4; P0.y = T.y + 0.05 * q; P0.z = T.z + T.fz * 0.4;
        let p;
        if (u < 0.3) { const v = easeOut(u / 0.3); P1.x = T.x + T.fx * 0.4 * v; P1.y = T.y + 0.05 * q * v; P1.z = T.z + T.fz * 0.4 * v; p = P1; }
        else p = arcTo(P1, P0, N, easeIn((u - 0.3) / 0.7), 0.9);
        frag(geo, th, p.x, p.y, p.z, 0, 1, c, 0.95 * fade(u, 0.85), 1 - 0.3 * u);
      }
      return;
    }
    // flow: 스캔 줄 + 노드에서 내리는 옅은 빛 원뿔 + 떠오른 조각이 노드로
    const sc = seg(k, 0, 0.5);
    if (sc < 1) {
      const zz = T.z - w + 2 * w * easeOut(sc), A = 0.9 * (1 - sc * 0.4);
      geo.line(T.x - w * 1.1, T.top + 0.05, zz, T.x + w * 1.1, T.top + 0.05, zz, c, A, 2);
      geo.line(N.x, N.y, N.z, T.x - w * 1.1, T.top + 0.05, zz, c, 0.18 * A); geo.line(N.x, N.y, N.z, T.x + w * 1.1, T.top + 0.05, zz, c, 0.18 * A);
    }
    for (let q = 0; q < n; q++) {
      const u = seg(k, 0.15 + q * 0.09, 0.15 + q * 0.09 + 0.6);
      if (u <= 0 || u >= 1) continue;
      const ox = (((q * 37) % 5) - 2) * w * 0.35, oz = (((q * 53) % 5) - 2) * w * 0.3;
      P0.x = T.x + ox; P0.y = T.top + 0.7 * S; P0.z = T.z + oz;
      let p;
      if (u < 0.25) { const v = easeOut(u / 0.25); P1.x = P0.x; P1.y = T.top + (0.1 + 0.6 * v) * S; P1.z = P0.z; p = P1; }
      else p = arcTo(P1, P0, N, easeIn((u - 0.25) / 0.75), 1.0);
      const [dx, dz] = dirXZ(p, N);
      frag(geo, th, p.x, p.y, p.z, dx, dz, c, 0.95 * fade(u, 0.8), 1 - 0.45 * u);
    }
  },
  // 쓰기 시작: 노드에서 조각(우주선·서류)이 대상으로 날아감
  carry(geo, th, e, k, T, N, _a, c) {
    P0.x = T.x; P0.y = T.top + 0.35; P0.z = T.z;
    const n = th === 'planet' ? 1 : Math.min(5, 2 + e.n);
    for (let q = 0; q < n; q++) {
      const u = seg(k, q * 0.12, q * 0.12 + (th === 'planet' ? 0.95 : 0.75));
      if (u <= 0 || u >= 1) continue;
      const p = arcTo(P1, N, P0, easeOut(u), th === 'voxel' ? 0.9 : 1.3);
      const [dx, dz] = dirXZ(N, P0);
      frag(geo, th, p.x, p.y, p.z, dx, dz, c, 0.95 * fade(u, 0.85), th === 'planet' ? 1.5 : 1);
      if (th === 'planet') { geo.line(p.x, p.y, p.z, p.x, p.y - 0.4, p.z, c, 0.6); cube(geo, p.x, p.y - 0.55, p.z, 0.14, c, 0.8); } // 드론이 매단 화물
    }
  },
  // 생성: 층층이 쌓여 솟음(흐름 = 3D 프린트 헤드, Planet = 크레인, 복셀 = 새 서류가 칸에 꽂히고 초록 체크)
  build(geo, th, e, k, T, N, _a, c, KI) {
    const w = Math.max(0.2, T.C * 0.4), h = Math.max(0.25, T.top - T.Y0), Y0 = T.Y0;
    if (th === 'voxel') {
      const u = seg(k, 0, 0.45), y = T.y + 1.1 * (1 - easeIn(u)) + (u >= 1 ? Math.max(0, Math.sin(seg(k, 0.45, 0.6) * Math.PI)) * 0.08 : 0);
      frag(geo, th, T.x + T.fz * 0, y, T.z, 0, 1, c, 0.95 * fade(k, 0.8), 1.1);
      if (k > 0.45) { const v = seg(k, 0.45, 1); ripple(geo, T.x, T.y, T.z, 0.15 + 0.6 * v, c, 0.7 * (1 - v), 14);
        const cx = T.x, cy = T.top + 0.35; geo.line(cx - 0.12, cy, T.z, cx - 0.03, cy - 0.1, T.z, c, 0.9 * (1 - v)); geo.line(cx - 0.03, cy - 0.1, T.z, cx + 0.16, cy + 0.14, T.z, c, 0.9 * (1 - v)); }
      return;
    }
    const L = 4, lay = seg(k, 0.12, 0.8) * L;
    for (let q = 0; q < Math.min(L, Math.ceil(lay)); q++) { const y = Y0 + (h * (q + 1)) / L, A = 0.75 * fade(k, 0.8) * (q + 1 > lay ? lay - q : 1); geo.rect(T.x - w, y, T.z - w, T.x + w, T.z + w, c, A); }
    if (th === 'planet') { // 크레인: 기둥 + 팔 + 매달린 블록이 내려와 얹힘
      const mx = T.x + w * 1.6, mz = T.z - w * 1.6, mt = Y0 + h + 2.2, A = 0.7 * fade(k, 0.8);
      geo.line(mx, Y0, mz, mx, mt, mz, c, A); geo.line(mx, mt, mz, T.x, mt, T.z, c, A); geo.line(mx - 0.15, mt - 0.3, mz, mx, mt, mz, c, A * 0.7);
      const hy = mt - 0.3 - (mt - 0.3 - (Y0 + h)) * easeOut(seg(k, 0.05, 0.7));
      geo.line(T.x, mt, T.z, T.x, hy, T.z, c, A * 0.8);
      geo.rect(T.x - w * 0.7, hy, T.z - w * 0.7, T.x + w * 0.7, T.z + w * 0.7, c, A);
    } else { // 흐름: 프린트 헤드(가로 빛줄)가 지금 층 높이에서 오가고, 네 모서리 빛기둥
      if (lay < L) { const y = Y0 + (h * (Math.floor(lay) + 1)) / L, xx = T.x - w + 2 * w * (0.5 - 0.5 * Math.cos(lay * Math.PI * 2)); geo.line(xx, y, T.z - w * 1.2, xx, y, T.z + w * 1.2, c, 0.95, 2); }
      const pa = 0.55 * (1 - k);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) geo.line(T.x + sx * w, Y0, T.z + sz * w, T.x + sx * w, Y0 + h + 2.4 * (1 - k), T.z + sz * w, c, pa);
    }
    if (k > 0.75) { const v = seg(k, 0.75, 1); ripple(geo, T.x, Y0 + 0.03, T.z, w * (1.2 + 2.2 * v), KI.zone ?? c, 0.5 * (1 - v)); } // 흙먼지 고리
  },
  // 편집: 커서가 깜빡이고 하이라이트 줄이 훑은 뒤 지운 조각이 흩어지고 새 줄이 옆에서 끼워짐
  edit(geo, th, e, k, T, N, _a, c, KI) {
    const w = Math.max(0.2, T.C * 0.4), y = T.top + 0.04, dc = KI.del ?? c, nc = KI.new ?? c;
    const nDel = Math.max(1, Math.min(4, Math.round(Math.log2(1 + (e.sz || 2))))) ;
    if (th === 'voxel') {
      const A = 0.9 * fade(k, 0.7), on = Math.sin(k * 30) > -0.2;
      geo.rect(T.x - 0.1, T.y + 0.17, T.z - 0.03, T.x + 0.1, T.z + 0.03, c, A * (on ? 1 : 0.35)); // 탭 하이라이트(빨간 펜 표시 대신 따뜻한 색)
      for (let q = 0; q < nDel; q++) { const u = seg(k, 0.15 + q * 0.06, 0.75); if (u <= 0 || u >= 1) continue; geo.box(T.x + T.fx * 0.2 + (q - nDel / 2) * 0.12 * u, T.y - 1.1 * easeIn(u) + 0.2 * Math.sin(u * Math.PI), T.z + T.fz * (0.2 + 0.3 * u), 0.08, 0.02, 0.06, dc, 0.9 * (1 - u), null); }
      const s = seg(k, 0.45, 0.85); if (s > 0) frag(geo, th, T.x, T.y + 0.6 * (1 - easeOut(s)), T.z + T.fz * 0.05, 0, 1, nc, 0.95 * fade(k, 0.9), 0.8);
      return;
    }
    if (th === 'planet') { // 수리 드론이 옥상에서 용접(불꽃), 낡은 지붕 판이 떨어지고 새 판이 내려앉음
      const hx = T.x + w * 0.6 + Math.sin(k * 9) * 0.08, hy = T.top + 0.9 + Math.sin(k * 13) * 0.05, A = fade(k, 0.85);
      frag(geo, th, hx, hy, T.z, -1, 0, c, 0.95 * A, 1.4);
      geo.line(hx, hy, T.z, T.x, y, T.z, c, 0.4 * A);
      if (k < 0.6) for (let q = 0; q < 3; q++) if (Math.sin(k * 50 + q * 2) > 0.3) dot(geo, T.x + (q - 1) * 0.12, y + 0.05, T.z + (q % 2) * 0.1, 0.1, c, 0.9);
      for (let q = 0; q < nDel; q++) { const u = seg(k, 0.2 + q * 0.07, 0.8); if (u <= 0 || u >= 1) continue; const sx = q % 2 ? 1 : -1, x0 = T.x + sx * w * (0.4 + 1.2 * u), yy = y + 0.3 * Math.sin(u * Math.PI) - (y - T.Y0) * easeIn(u); geo.line(x0 - 0.2, yy, T.z, x0 + 0.2, yy - 0.1 * sx, T.z + 0.05, dc, 0.85 * (1 - u)); }
      const s = seg(k, 0.5, 0.9); if (s > 0) geo.rect(T.x - w * 0.8, y + 1.0 * (1 - easeOut(s)), T.z - w * 0.8, T.x + w * 0.8, T.z + w * 0.8, nc, 0.85 * fade(k, 0.9));
      return;
    }
    const rows = 3, row = Math.min(rows - 1, Math.floor(seg(k, 0, 0.5) * rows)), zr = T.z - w + (2 * w * (row + 1)) / (rows + 1);
    const hl = seg(k, 0.05, 0.5);
    if (hl < 1) geo.line(T.x - w, y, zr, T.x - w + 2 * w * easeOut(hl), y, zr, c, 0.9, 2);
    if (Math.sin(k * 26) > 0 && k < 0.85) geo.line(T.x - w + 2 * w * easeOut(hl), y, zr - 0.18, T.x - w + 2 * w * easeOut(hl), y + 0.42, zr - 0.18, c, 0.95); // 커서
    for (let q = 0; q < nDel; q++) { // 지운 줄 조각: 위로 튀어 흩어지며 떨어짐
      const u = seg(k, 0.3 + q * 0.05, 0.85); if (u <= 0 || u >= 1) continue;
      const ang = (q / nDel) * TAU + 0.6, r = w * (0.3 + 1.6 * u), yy = y + 1.1 * u - 1.6 * u * u;
      const x0 = T.x + Math.cos(ang) * r, z0 = zr + Math.sin(ang) * r * 0.6;
      geo.line(x0 - 0.22 * Math.cos(ang + u * 4), yy, z0 - 0.22 * Math.sin(ang + u * 4), x0 + 0.22 * Math.cos(ang + u * 4), yy, z0 + 0.22 * Math.sin(ang + u * 4), dc, 0.9 * (1 - u));
    }
    const s = seg(k, 0.5, 0.88); // 새 줄이 옆에서 미끄러져 끼워짐
    if (s > 0) { const x1 = T.x + w + 2.4 * (1 - easeOut(s)); geo.line(x1 - 2 * w * 0.8, y, zr, x1, y, zr, nc, 0.95 * fade(k, 0.9), 2); }
  },
  // 삭제: 판 조각이 사방으로 튀어 흩어지고 바닥 구멍(윤곽)이 오므라들며 꺼짐
  shatter(geo, th, e, k, T, N, _a, c) {
    const w = Math.max(0.2, T.C * 0.4), y = T.top;
    if (th === 'voxel') { // 파쇄기: 서류가 가는 띠 다섯으로 잘려 떨어짐
      for (let q = 0; q < 5; q++) { const u = seg(k, q * 0.05, 0.8 + q * 0.04); if (u <= 0 || u >= 1) continue; const x0 = T.x + (q - 2) * 0.05 + (q - 2) * 0.12 * u, yy = T.y - 1.1 * easeIn(u); geo.line(x0, yy, T.z + T.fz * 0.1, x0, yy - 0.18, T.z + T.fz * 0.1, c, 0.9 * (1 - u)); }
      ripple(geo, T.x + T.fx * 0.3, 0.03, T.z + T.fz * 0.4, 0.15 + 0.5 * k, c, 0.5 * (1 - k), 12);
      return;
    }
    const n = th === 'planet' ? 10 : 8;
    for (let q = 0; q < n; q++) {
      const ang = (q / n) * TAU + (hash(e.id) % 7) * 0.3, r = w * (0.6 + 2.4 * easeOut(k));
      const yy = y + (1.3 * k - 2.6 * k * k) * S - (th === 'planet' ? 0 : 0), x0 = T.x + Math.cos(ang) * r, z0 = T.z + Math.sin(ang) * r;
      if (th === 'planet') { dot(geo, x0, Math.max(T.Y0, yy), z0, 0.13 + 0.06 * (q % 3), c, 0.85 * (1 - k)); continue; }
      const rot = ang + k * 7;
      geo.line(x0 - Math.cos(rot) * 0.28, yy, z0 - Math.sin(rot) * 0.28, x0 + Math.cos(rot) * 0.28, yy + 0.1, z0 + Math.sin(rot) * 0.28, c, 0.9 * (1 - k));
    }
    const hk = 1 - easeIn(k); // 바닥 구멍이 오므라듦(땅으로 꺼짐)
    geo.rect(T.x - w * hk, T.Y0 + 0.02, T.z - w * hk, T.x + w * hk, T.z + w * hk, c, 0.7 * (1 - k * 0.5));
    if (th === 'planet') { ripple(geo, T.x, T.Y0 + 0.04, T.z, w * (1 + 3 * k), c, 0.5 * (1 - k)); ripple(geo, T.x, T.Y0 + 0.04, T.z, w * (0.6 + 2 * k), c, 0.35 * (1 - k)); } // 흙먼지
  },
  // 검색: 레이더(흐름)·궤도 탐사선(Planet)·손전등(복셀)이 바닥을 훑음
  radar(geo, th, e, k, T, N, area, c) {
    const A = area || { x: N.x, y: N.y - 2, z: N.z, r: 6 };
    const r = Math.max(2, Math.min(A.r, 26)), y = A.y + 0.06;
    if (th === 'voxel' && A.sx0 != null) { // 손전등: 직원 머리에서 서가 앞을 오가는 둥근 빛
      const u = 0.5 - 0.5 * Math.cos(k * TAU), sx = A.sx0 + (A.sx1 - A.sx0) * u, sz = A.sz0 + (A.sz1 - A.sz0) * u, sy = 1.2;
      const F = fade(k, 0.8), H = N || { x: A.x, y: 1.6, z: A.z };
      for (const [ox, oy] of [[-0.35, -0.3], [0.35, -0.3], [0.35, 0.3], [-0.35, 0.3]]) geo.line(H.x, H.y + 0.2, H.z, sx + ox, sy + oy, sz, c, 0.3 * F);
      geo.vring(sx, sy, sz, 0.42, c, 0.8 * F, 16);
      return;
    }
    const ang = (hash(e.node) % 628) / 100 + k * TAU * 1.15, F = fade(k, 0.8);
    const ex = A.x + Math.cos(ang) * r, ez = A.z + Math.sin(ang) * r;
    if (th === 'planet') { // 궤도 탐사선(위 6)에서 바닥 훑는 빛 원뿔
      const sy = y + 7, hx = A.x + Math.cos(ang * 0.3) * 1.5, hz = A.z + Math.sin(ang * 0.3) * 1.5;
      frag(geo, th, hx, sy, hz, Math.cos(ang), Math.sin(ang), c, 0.9 * F, 1.8);
      for (let j = 0; j < 3; j++) { const aj = ang - j * 0.1, rr = r * (0.55 + 0.45 * j / 2); geo.line(hx, sy, hz, A.x + Math.cos(aj) * rr, y, A.z + Math.sin(aj) * rr, c, 0.32 * F); }
      geo.line(A.x + Math.cos(ang) * r * 0.5, y, A.z + Math.sin(ang) * r * 0.5, ex, y, ez, c, 0.8 * F, 2);
    } else {
      geo.line(A.x, y, A.z, ex, y, ez, c, 0.9 * F, 2);
      for (let j = 1; j <= 3; j++) { const aj = ang - j * 0.12; geo.line(A.x, y, A.z, A.x + Math.cos(aj) * r, y, A.z + Math.sin(aj) * r, c, (0.45 / j) * F); } // 잔광
      if (N) geo.line(N.x, N.y, N.z, ex, y, ez, c, 0.2 * F);
    }
    for (let q = 0; q < 2; q++) { const kk = seg(k, q * 0.35, q * 0.35 + 0.6); if (kk > 0 && kk < 1) ripple(geo, A.x, y, A.z, r * easeOut(kk), c, 0.5 * (1 - kk), 36); }
  },
  // 검색에 걸린 대상: 위로 솟는 바늘 + 퍼지는 고리
  ping(geo, th, e, k, T, N, _a, c) {
    const y = th === 'voxel' ? T.y : T.top + 0.05;
    if (th === 'voxel') { ripple(geo, T.x, y, T.z, 0.12 + 0.4 * easeOut(k), c, 0.9 * (1 - k), 12); return; }
    geo.line(T.x, y, T.z, T.x, y + 1.4 * Math.sin(Math.PI * Math.min(1, k * 1.6)), T.z, c, 0.95 * (1 - k * 0.6), 2);
    ripple(geo, T.x, y, T.z, T.C * (0.2 + 0.8 * easeOut(k)), c, 0.9 * (1 - k), 18);
  },
  // DB 조회: 데이터 방울이 퐁퐁 떠올라 노드로
  bubbles(geo, th, e, k, T, N, _a, c) {
    const n = Math.min(7, 4 + e.n), y0 = th === 'planet' ? T.Y0 + 0.05 : th === 'voxel' ? T.y : T.top;
    for (let q = 0; q < n; q++) {
      const u = seg(k, q * 0.08, q * 0.08 + 0.7);
      if (u <= 0 || u >= 1) continue;
      const ox = Math.sin(q * 2.3) * T.C * 0.25, oz = Math.cos(q * 1.7) * T.C * 0.25;
      let x, y, z;
      if (u < 0.55) { const v = u / 0.55; x = T.x + ox + Math.sin(v * 9 + q) * 0.12; y = y0 + 1.4 * S * easeOut(v); z = T.z + oz; if (th === 'voxel') { x += T.fx * 0.4 * v; z += T.fz * 0.4 * v; } }
      else { P0.x = T.x + ox; P0.y = y0 + 1.4 * S; P0.z = T.z + oz; const p = arcTo(P1, P0, N, easeIn((u - 0.55) / 0.45), 0.6); x = p.x; y = p.y; z = p.z; }
      const s = 0.14 + 0.1 * Math.min(1, u * 2);
      if (th === 'planet') geo.vring(x, y, z, s, c, 0.9 * fade(u, 0.85), 8);
      else if (th === 'voxel') geo.box(x, y, z, 0.12, 0.08, 0.02, c, 0.9 * fade(u, 0.85), null);
      else dot(geo, x, y, z, s * 1.6, c, 0.9 * fade(u, 0.85));
      if (th === 'planet' && u > 0.5 && u < 0.6) ripple(geo, T.x + ox, T.Y0 + 0.05, T.z + oz, 0.3, c, 0.6, 10); // 물가 물결
    }
  },
  // DB 쓰기: 노드에서 방울이 떨어져 들어가고 물결(Planet 은 구름비, 복셀은 금고에 서류)
  pour(geo, th, e, k, T, N, _a, c) {
    const n = Math.min(6, 3 + e.n), y1 = th === 'planet' ? T.Y0 + 0.05 : th === 'voxel' ? T.y : T.top;
    P0.x = T.x; P0.y = y1; P0.z = T.z;
    for (let q = 0; q < n; q++) {
      const u = seg(k, q * 0.09, q * 0.09 + 0.55);
      if (u <= 0) continue;
      if (u >= 1) { const v = seg(k, q * 0.09 + 0.55, q * 0.09 + 0.85); if (v > 0 && v < 1) ripple(geo, T.x, y1 + 0.02, T.z, T.C * (0.2 + 0.6 * v), c, 0.7 * (1 - v), 18); continue; }
      let p;
      if (th === 'planet') { P1.x = T.x + Math.sin(q * 2.1) * T.C * 0.3; P1.y = y1 + 4 * (1 - easeIn(u)); P1.z = T.z + Math.cos(q * 1.3) * T.C * 0.3; p = P1;
        geo.line(p.x, p.y, p.z, p.x, p.y + 0.35, p.z, c, 0.85); continue; }
      p = arcTo(P1, N, P0, easeIn(u), th === 'voxel' ? 0.8 : 0.6);
      if (th === 'voxel') frag(geo, th, p.x, p.y, p.z, 0, 1, c, 0.95, 1); else dot(geo, p.x, p.y, p.z, 0.24, c, 0.95);
    }
    if (th === 'planet' && k < 0.7) { const A = 0.5 * fade(k, 0.5); for (let q = 0; q < 3; q++) ripple(geo, T.x + (q - 1) * 0.5, y1 + 4.3, T.z, 0.45, c, A, 12); } // 구름
  },
  // push 시작: 꾸러미가 포장됨(모서리가 하나씩 그어짐)
  pack(geo, th, e, k, T, N, _a, c) {
    const y = (th === 'voxel' ? T.y : T.top) + 0.5;
    if (th === 'planet') { parcel(geo, th, T.x, T.Y0 + 0.05, T.z, 1, c, 0.8 * fade(k), Math.sin(k * 20) > 0 ? 0.3 : 0); return; }
    if (th === 'voxel') { parcel(geo, th, T.x, y, T.z, 0.7, c, 0.85 * Math.min(1, k * 2)); return; }
    cube(geo, T.x, y, T.z, 0.32, c, 0.9, Math.ceil(easeOut(k) * 12));
  },
  // push·원격 올림: 꾸러미가 쏘아 올려짐(원격은 섬 바깥으로), 아래 충격 고리·꼬리
  launch(geo, th, e, k, T, N, _a, c) {
    const n = Math.min(3, Math.max(1, e.n)), horiz = e.k === 'remote';
    const y0 = (th === 'voxel' ? T.y : th === 'planet' ? T.Y0 + 0.05 : T.top) + 0.3;
    for (let q = 0; q < n; q++) {
      const u = seg(k, q * 0.14, q * 0.14 + 0.78);
      if (u <= 0 || u >= 1) continue;
      const v = easeIn(u);
      let x = T.x, y = y0 + 11 * S * v, z = T.z;
      if (horiz) { const ox = T.ox || T.fx || 1, oz = T.oz || T.fz || 0; x = T.x + ox * 12 * S * v; z = T.z + oz * 12 * S * v; y = y0 + 2.5 * S * Math.sin(u * Math.PI * 0.6); }
      else if (th === 'voxel') { x = T.x + (T.fx || 0) * 5 * S * v; z = T.z + (T.fz || 1) * 5 * S * v; y = y0 + 7 * S * Math.sin(u * Math.PI * 0.55); }
      parcel(geo, th, x, y, z, th === 'planet' ? 1.1 : 0.9, c, 0.95 * fade(u, 0.8), 1);
      geo.line(x, y - 0.3, z, x - (x - T.x) * 0.25, y - (y - y0) * 0.35 - 0.3, z - (z - T.z) * 0.25, c, 0.5 * (1 - u), 2); // 꼬리
    }
    const s = seg(k, 0, 0.35); if (s > 0 && s < 1) { ripple(geo, T.x, y0 - 0.25, T.z, T.C * (0.3 + 1.4 * s), c, 0.8 * (1 - s)); if (th === 'planet') ripple(geo, T.x, T.y, T.z, T.C * (0.6 + s), c, 0.6 * (1 - s)); }
  },
  // pull·fetch·clone·원격 내림: 꾸러미가 하늘에서 떨어져 내려앉고(통통) 뚜껑이 열림
  drop(geo, th, e, k, T, N, _a, c, KI) {
    const y1 = (th === 'voxel' ? T.y : th === 'planet' ? T.Y0 + 0.05 : T.top) + 0.3, u = seg(k, 0, 0.55);
    const b = u >= 1 ? Math.abs(Math.sin(seg(k, 0.55, 0.8) * Math.PI)) * 0.35 * (1 - seg(k, 0.55, 0.8)) : 0;
    const y = y1 + 7 * S * (1 - easeIn(u)) + b, A = 0.95 * fade(k, 0.85);
    parcel(geo, th, T.x, y, T.z, th === 'planet' ? 0.9 : 0.8, c, A);
    if (th === 'planet' && u < 1) geo.vring(T.x, y + 1.6, T.z, 0.7, c, 0.6 * A, 12, false, 0, 1); // 낙하산
    if (u >= 1) { const v = seg(k, 0.6, 1); ripple(geo, T.x, y1 - 0.25, T.z, T.C * (0.3 + 0.8 * v), KI.new ?? c, 0.6 * (1 - v));
      if (th === 'flow') { geo.line(T.x - 0.32, y1 + 0.32, T.z, T.x - 0.32 - 0.4 * v, y1 + 0.32 + 0.3 * v, T.z, c, A); geo.line(T.x + 0.32, y1 + 0.32, T.z, T.x + 0.32 + 0.4 * v, y1 + 0.32 + 0.3 * v, T.z, c, A); } }
  },
  // 커밋: 도장이 쿵 — 내려와 찍히고 충격 고리 + 바깥 눈금
  stamp(geo, th, e, k, T, N, _a, c, KI) {
    const y = th === 'voxel' ? T.y + 0.2 : T.top + 0.05, u = seg(k, 0, 0.28), yy = y + 2.2 * S * (1 - easeIn(u));
    if (th === 'planet') { const s = seg(k, 0, 1); ripple(geo, T.x, T.y, T.z, T.C * (0.5 + 0.5 * Math.sin(s * Math.PI)), c, 0.7 * (1 - s)); geo.vring(T.x, T.y, T.z, T.C * (0.7 + 0.6 * s), c, 0.6 * (1 - s), 20); return; }
    if (th === 'voxel') { geo.box(T.x, yy + 0.18, T.z, 0.14, 0.24, 0.14, c, 0.9 * fade(k, 0.6), null); geo.box(T.x, yy + 0.03, T.z, 0.3, 0.06, 0.22, c, 0.9 * fade(k, 0.6), null); }
    else ripple(geo, T.x, yy, T.z, 0.55, c, 0.95 * fade(k, 0.5), 20);
    if (u >= 1) { const v = seg(k, 0.28, 1); ripple(geo, T.x, y, T.z, 0.4 + 1.6 * v, c, 0.8 * (1 - v));
      for (let q = 0; q < 6; q++) { const a = (q / 6) * TAU; geo.line(T.x + Math.cos(a) * (0.6 + v), y, T.z + Math.sin(a) * (0.6 + v), T.x + Math.cos(a) * (0.9 + 1.3 * v), y, T.z + Math.sin(a) * (0.9 + 1.3 * v), c, 0.7 * (1 - v)); }
      if (th === 'voxel') geo.rect(T.x - 0.14, y - 0.15, T.z - 0.1, T.x + 0.14, T.z + 0.1, KI.new ?? c, 0.8 * (1 - v)); }
  },
  // 서비스: 안테나 신호파 — 퍼지는 고리 + 노드 ↔ 서비스 사이를 오가는 신호 점(쓰기는 노드 → 서비스)
  signal(geo, th, e, k, T, N, _a, c) {
    const y = th === 'voxel' ? 3.0 : T.y, out = e.v === 'write' || e.v === 'create' || e.v === 'modify';
    for (let q = 0; q < 3; q++) { const kk = seg(k, q * 0.2, q * 0.2 + 0.6); if (kk > 0 && kk < 1) { if (th === 'voxel') geo.ring(T.x, y, T.z, 0.2 + 1.2 * kk, c, 0.8 * (1 - kk), 16, true); else if (th === 'planet') geo.vring(T.x, y, T.z, 0.3 + 1.6 * kk, c, 0.8 * (1 - kk), 18); else ripple(geo, T.x, y, T.z, 0.3 + 1.8 * kk, c, 0.8 * (1 - kk)); } }
    P0.x = T.x; P0.y = y; P0.z = T.z;
    for (let q = 0; q < 3; q++) {
      const u = seg(k, 0.1 + q * 0.12, 0.1 + q * 0.12 + 0.55); if (u <= 0 || u >= 1) continue;
      const p = out ? arcTo(P1, N, P0, u, 0.5) : arcTo(P1, P0, N, u, 0.5);
      const [dx, dz] = out ? dirXZ(N, P0) : dirXZ(P0, N);
      if (th === 'flow') dot(geo, p.x, p.y, p.z, 0.2, c, 0.9); else frag(geo, th, p.x, p.y, p.z, dx, dz, c, 0.9, th === 'planet' ? 1 : 0.6);
    }
  },
  // 웹(대상 없음): 노드 위로 안테나 신호파 세 겹
  web(geo, th, e, k, T, N, _a, c) {
    for (let q = 0; q < 3; q++) { const kk = seg(k, q * 0.18, q * 0.18 + 0.65); if (kk <= 0 || kk >= 1) continue; const y = N.y + (0.8 + 2.2 * kk) * S, r = (0.4 + 1.4 * kk) * S;
      if (th === 'planet') geo.vring(N.x, y, N.z, r, c, 0.7 * (1 - kk), 18); else geo.ring(N.x, y, N.z, r, c, 0.7 * (1 - kk), 20, th === 'voxel'); }
    geo.line(N.x, N.y, N.z, N.x, N.y + 1.0, N.z, c, 0.5 * fade(k));
  },
  // 원격 조회: 끈을 따라 신호가 섬 바깥으로 갔다 돌아옴
  tether(geo, th, e, k, T, N, _a, c) {
    const ox = T.ox || T.fx || 1, oz = T.oz || T.fz || 0, L = (th === 'voxel' ? 3.5 : 5.5) * S, u = k < 0.5 ? easeOut(k * 2) : 1 - easeIn((k - 0.5) * 2);
    const x = T.x + ox * L * u, z = T.z + oz * L * u, y = th === 'voxel' ? 0.3 : T.y;
    if (th === 'flow') dot(geo, x, y, z, 0.3, c, 0.95); else frag(geo, th, x, y, z, k < 0.5 ? ox : -ox, k < 0.5 ? oz : -oz, c, 0.95, 1.2);
    if (k > 0.45 && k < 0.6) ripple(geo, T.x + ox * L, y, T.z + oz * L, 0.4 + 4 * (k - 0.45), c, 0.7);
  },
  // 산출물: 사진 찍히듯 플래시(빛 터짐 + 살 + 테두리가 위에서 아래로 현상됨)
  flash(geo, th, e, k, T, N, _a, c, KI) {
    const cy = th === 'voxel' ? T.y + 0.1 : (T.y + T.top) / 2, s = th === 'voxel' ? 0.5 : 1;
    const f = seg(k, 0, 0.25), F = 1 - f;
    if (f < 1) { dot(geo, T.x, th === 'planet' ? T.top - 0.4 : cy, T.z, (0.7 - 0.4 * f) * s, KI.imp ?? c, 0.95 * F);
      for (let q = 0; q < 8; q++) { const a = (q / 8) * TAU + 0.2, r0 = 0.4 * s * S, r1 = (0.8 + 1.6 * f) * s * S; geo.line(T.x + Math.cos(a) * r0, cy + Math.sin(a) * r0, T.z, T.x + Math.cos(a) * r1, cy + Math.sin(a) * r1, T.z, KI.imp ?? c, 0.85 * F); } }
    const d = seg(k, 0.2, 0.85), w = (th === 'voxel' ? 0.26 : Math.max(0.3, T.C * 0.36)), hh = th === 'voxel' ? 0.18 : Math.max(0.4, (T.top - T.y) * 0.45);
    if (d > 0) { const A = 0.85 * fade(k, 0.85);
      geo.line(T.x - w, cy + hh, T.z, T.x + w, cy + hh, T.z, c, A); geo.line(T.x - w, cy - hh, T.z, T.x + w, cy - hh, T.z, c, A); geo.line(T.x - w, cy - hh, T.z, T.x - w, cy + hh, T.z, c, A); geo.line(T.x + w, cy - hh, T.z, T.x + w, cy + hh, T.z, c, A);
      const L = 4; for (let q = 0; q < Math.floor(d * L); q++) { const yy = cy + hh - ((q + 1) * 2 * hh) / (L + 1); geo.line(T.x - w * 0.8, yy, T.z, T.x + w * (q % 2 ? 0.3 : 0.75), yy, T.z, c, A * 0.8); } }
  },
  // 실패: 빨간 스파크가 튀고 조각이 노드 쪽으로 튕겨 나오며 대상이 떨림
  fail(geo, th, e, k, T, N, _a, c) {
    const y = th === 'voxel' ? T.y : T.top + 0.1, n = 10;
    for (let q = 0; q < n; q++) { const a = (q / n) * TAU + 0.3, u = easeOut(k), r = (0.2 + 1.6 * u) * S, yy = y + 1.2 * u - 1.8 * u * u + 0.2;
      const x0 = T.x + Math.cos(a) * r, z0 = T.z + Math.sin(a) * r; geo.line(x0, yy, z0, x0 - Math.cos(a) * 0.25, yy - 0.12, z0 - Math.sin(a) * 0.25, c, 0.95 * (1 - k)); }
    const j = Math.sin(k * 45) * 0.1 * (1 - k), w = Math.max(0.15, T.C * 0.42);
    if (th !== 'voxel') geo.rect(T.x - w + j, y, T.z - w, T.x + w + j, T.z + w, c, 0.8 * (1 - k));
    else geo.rect(T.x - 0.12 + j, T.y + 0.18, T.z - 0.04, T.x + 0.12 + j, T.z + 0.04, c, 0.8 * (1 - k));
    P0.x = T.x; P0.y = y + 0.3; P0.z = T.z;
    for (let q = 0; q < 2; q++) { const u = seg(k, q * 0.12, 0.7 + q * 0.12); if (u <= 0 || u >= 1) continue; P2.x = T.x + (N.x - T.x) * 0.35; P2.y = Math.min(N.y, y + 1) ; P2.z = T.z + (N.z - T.z) * 0.35;
      const p = arcTo(P1, P0, P2, easeOut(u), 1.0 + q * 0.4); const [dx, dz] = dirXZ(P0, P2); frag(geo, th, p.x, p.y - 1.4 * u * u, p.z, -dx, -dz, c, 0.9 * (1 - u), 0.9); }
  },
  // 중지됨: 회색 — 조각이 천천히 가라앉아 사라지고 고리가 오므라듦
  stop(geo, th, e, k, T, N, _a, c) {
    const y = th === 'voxel' ? T.y : T.top;
    for (let q = 0; q < 3; q++) { const u = seg(k, q * 0.1, 0.9); if (u <= 0 || u >= 1) continue; frag(geo, th, T.x + (q - 1) * 0.3, y + 0.9 - (0.9 + (th === 'voxel' ? 0.8 : 0.3)) * easeIn(u), T.z + (q % 2) * 0.15, 0, 1, c, 0.8 * (1 - u), 0.9); }
    ripple(geo, T.x, th === 'voxel' ? 0.03 : T.Y0 + 0.03, T.z, Math.max(0.3, T.C * 0.5) * (1.2 - 0.8 * k), c, 0.55 * (1 - k), 18);
  },
};
export const ACT_DRAWN = Object.keys(DRAW);
