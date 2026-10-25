// 작업 대상 층 — 순수 부분. three·DOM·node 내장 없음(서버 ArtifactStore·웹 세 표현·시험 공용).
//
// 에이전트가 만들고(create)·고치고(modify)·지우고(delete)·쓰는(write) 대상 — 파일(폴더로 묶음)·산출물·저장소·DB·원격·외부 서비스 —
// 과 그것들과 에이전트 노드 사이의 상호작용을 다룬다. 서버는 도구 호출마다 이벤트 필드 `art`(대상 참조 배열)를 싣고,
// 웹은 ① 장부(ArtBook: 프로젝트별 대상·간선·최근 기록, 최근 7일) ② 섬 로컬 격자 배치(ArtLayout: 결정적·안정)
// ③ 연출 큐(ArtFx: 솟아오름·맥동·무너짐·패킷·경보) ④ 그릴 도형(artGeometry: 세계 좌표 상자·원기둥·선·점·라벨)으로 바꾼다.
// 흐름 3D·2D 는 ④만 그린다. Planet·복셀은 ①～③을 그대로 쓰고 자기 은유로 ④를 대신하면 된다(계약).

import { ArtActs, ActPos, drawActs } from './art-act-core.mjs'; // 동사 × 대상 종류 상호작용 연출
import { t, fmtNum } from './i18n.mjs'; // 다국어(라벨은 읽을 때마다 지금 언어 — 서버는 라벨을 쓰지 않음)

let cssDone = false;
/** 라벨·팝업·⚙ 줄 스타일(artifacts.css) 한 번 불러오기 — 브라우저에서만 */
export function ensureArtCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const href = new URL('./artifacts.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

// ───────────── 상수·열거 ─────────────
export const ART = {
  WINDOW_MS: 7 * 86_400_000,   // 프로젝트 누적 창(7일) — 이보다 오래된 대상은 장부에서 빠짐
  MAX_ITEMS: 500,              // 프로젝트당 대상 상한(넘으면 중요도 없는·오래된 것부터)
  LOG_MAX: 12,                 // 대상마다 최근 기록(누가 언제 무엇을)
  WHO_MAX: 8,                  // 대상마다 간선(노드) 상한
  FOLDER_MAX: 80,              // 프로젝트당 폴더 구역 상한(넘으면 '…' 구역 하나로 — 폴더 LOD)
  SEEN_MAX: 40_000,            // 중복 적용 방지(toolUseId|대상) 기억 상한
  CELL: 2.3,                   // 격자 한 칸(세계 단위)
  PITCH: 5,                    // 구역(폴더) 기준점 간격(칸)
  FLOOR_Y: -2.2,               // 바닥층 높이: 섬 원판(ISLAND_Y −2.5) 바로 위 — 깊으면 비스듬한 카메라에서 옆 섬으로 투영돼 겹쳐 보였다
  LOD_SCALE: 0.5,              // 대상별 배치를 이보다 더 줄여야 섬에 들면 폴더 묶음(집계) 배치로(섬을 키우지 않음)
  LOD_PX: 5,                   // 한 칸이 화면에서 이보다 작으면(멀리) 폴더 묶음 외곽선만
  DETAIL_PX: 9,                // 한 칸이 이보다 크면 하위 종류 무늬·옆 모서리까지
  LIT_MAX: 8,                  // 동시에 점등(최근 접촉으로 밝아짐)되는 대상 상한
  NAME_READ_PX: 30,           // 바닥 글씨 한 줄이 화면에서 이보다 크면 섬 이름 라벨을 흐림(중복 줄이기)
  NAME_Y: -0.12,               // 바닥 글씨는 대상보다 살짝 아래(FLOOR_Y + NAME_Y, z-fighting 없음)
  EDGE_RECENT_MS: 30 * 60_000, // 지속 간선은 최근 30분 접촉만(발자국 강조면 전부)
  ALARM_MS: 10 * 60_000,       // 파괴적 작업 표식이 남는 시간
};
export const ART_KINDS = ['file', 'output', 'repo', 'db', 'remote', 'service'];
export const ART_VERBS = ['read', 'create', 'modify', 'delete', 'query', 'write', 'push'];
export const ART_X = ['rm', 'drop', 'force', 'overwrite'];          // 파괴적 작업 종류(overwrite 는 약한 경보)
export const ART_IMP = ['secret', 'prod', 'db', 'final'];            // 중요도 종류
export const ART_WRITE_VERBS = new Set(['create', 'modify', 'delete', 'write', 'push']);
export const ART_GLYPH = { file: '▤', output: '⎙', repo: '⎇', db: '⛁', remote: '⇄', service: '⌁' };
/** 키 → 지금 언어 라벨(읽을 때마다 t — 없는 키는 undefined 그대로) */
export const tLabels = (pre, keys) => Object.freeze(Object.defineProperties({}, Object.fromEntries(keys.map((k) => [k, { enumerable: true, get: () => t(pre + k) }]))));
export const ART_KIND_LABEL = tLabels('boards.kind.', ['file', 'output', 'repo', 'db', 'remote', 'service']);
export const ART_VERB_LABEL = tLabels('boards.verb.', ART_VERBS);
export const ART_X_LABEL = tLabels('boards.x.', ART_X);
export const ART_IMP_LABEL = tLabels('boards.imp.', ART_IMP);
/** 파괴적 작업 라벨(모르는 종류는 일반 문구) */
export const artXLabel = (x) => ART_X_LABEL[x] || t('boards.x.generic');

/** 짧은 해시(FNV-1a 32비트 → 16진 6자). 서버·웹이 같은 값을 낸다(외부 링크·minimal 접기) */
export function artHash(s, n = 6) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0').slice(0, n);
}
const extOf = (n) => { const m = /\.[A-Za-z0-9]{1,6}$/.exec(String(n || '')); return m ? m[0].toLowerCase() : ''; };
const dirOf = (p) => { const s = String(p || ''); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); };

/**
 * 대상 참조 하나를 '접는다'(외부 고정 링크·privacy minimal): 파일·산출물은 폴더까지만 남기고 파일명은 짧은 해시(확장자는 남김),
 * DB 이름·원격 호스트는 해시, 컬렉션은 뺀다. 저장소·서비스 이름은 그대로. 같은 입력이면 같은 출력(열쇠 일관).
 */
export function foldRef(r) {
  if (!r || typeof r !== 'object') return r;
  const o = { ...r };
  if (o.k === 'file' || o.k === 'output') {
    if (String(o.id || '').startsWith('artifact:')) return o; // 산출물 도구(Artifact)는 제목만이라 그대로
    const d = o.d != null ? o.d : dirOf(o.p || o.id);
    const n = '#' + artHash(o.id) + extOf(o.n || o.p || o.id);
    o.n = n; o.d = d; o.id = (d ? d + '/' : '') + n; o.p = o.id;
  } else if (o.k === 'db') {
    const eng = String(o.id || '').replace(/^db:/, '').split('/')[0] || 'db';
    const h = artHash(o.id, 4);
    o.id = `db:${eng}/#${h}`; o.n = `${eng} #${h}`; delete o.coll; delete o.p;
  } else if (o.k === 'remote') {
    const h = artHash(o.id, 4);
    o.id = `remote:#${h}`; o.n = `#${h}`; delete o.p;
  }
  return o;
}
/** 장부 항목(스냅샷 items)을 접는다 — foldRef 와 같은 규칙 + 기록(log)·간선은 그대로(노드 id·수·시각뿐) */
export function foldItem(it) {
  if (!it) return it;
  const f = foldRef({ k: it.k, id: it.id, n: it.n, p: it.p, d: it.d, coll: it.coll });
  const o = { ...it, id: f.id, n: f.n, d: f.d ?? it.d };
  if (f.p != null) o.p = f.p; else delete o.p;
  if (f.coll == null) delete o.coll;
  return o;
}

// ───────────── 정리(서버 graph.emit · 웹 장부 입력 공용) ─────────────
const STR_MAX = { id: 200, p: 220, n: 80, d: 160 };
const cleanStr = (s, n) => String(s).replace(/[\u0000-\u001f]/g, '').slice(0, n);
/**
 * 이벤트 art 배열 정리: 알 수 없는 키 버림·열거형 확인·수는 0 이상 정수·문자열 길이 상한(마스킹은 서버가 redact 를 넘겨 줌).
 * @param {any[]} arr  @param {{redact?:(s:string)=>string, fold?:boolean}} o
 */
export function sanitizeArt(arr, { redact = (s) => s, fold = false } = {}) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const r of arr.slice(0, 8)) {
    if (!r || typeof r !== 'object' || !ART_KINDS.includes(r.k) || !ART_VERBS.includes(r.v) || typeof r.id !== 'string' || !r.id) continue;
    const o = { k: r.k, v: r.v };
    let bad = false;
    for (const key of ['id', 'p', 'n', 'd']) {
      if (r[key] == null) continue;
      if (typeof r[key] !== 'string') continue;
      const s = cleanStr(redact(r[key]), STR_MAX[key]);
      if (key === 'id' && (!s || /\*\*\*/.test(s))) { bad = true; break; }
      if (/\*\*\*/.test(s)) continue;
      o[key] = s;
    }
    if (bad || !o.id) continue;
    for (const key of ['sz', 'rows', 'c']) if (Number.isFinite(r[key])) o[key] = Math.max(0, Math.round(r[key]));
    if (ART_X.includes(r.x)) o.x = r.x;
    if (ART_IMP.includes(r.imp)) o.imp = r.imp;
    if (r.est) o.est = 1;
    if (Array.isArray(r.coll)) { const c = r.coll.filter((x) => typeof x === 'string' && /^[\w.$-]{1,40}$/.test(x)).slice(0, 4); if (c.length) o.coll = c; }
    out.push(fold ? foldRef(o) : o);
  }
  return out.length ? out : null;
}

// ───────────── 신선도·중요도·굵기 ─────────────
/** 마지막 접촉 뒤 경과(ms) → 밝기 0.3～1 (10분까지 1, 7일에 0.3, 로그) */
export function freshness(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs <= 600_000) return 1;
  const h = ageMs / 3_600_000;
  return Math.max(0.3, 1 - (Math.log10(1 + h) / Math.log10(1 + 168)) * 0.7);
}
/** 누적 접촉 수 → 간선 굵기 단계 1～3 */
export const edgeWeight = (c) => (c >= 10 ? 3 : c >= 3 ? 2 : 1);
/** 바닥층에 그리는가: 파일·산출물은 만들기·고치기·지우기·쓰기가 있어야, 그 밖 종류는 읽기만이 아니면 */
export function isShown(it) {
  if (!it) return false;
  const c = it.cnt || {};
  if (it.k === 'file' || it.k === 'output') return (c.create || 0) + (c.modify || 0) + (c.delete || 0) + (c.write || 0) > 0;
  return (c.create || 0) + (c.modify || 0) + (c.delete || 0) + (c.write || 0) + (c.push || 0) + (c.query || 0) > 0;
}
const editsOf = (it) => { const c = it.cnt || {}; return (c.create || 0) + (c.modify || 0) + (c.write || 0) + (c.push || 0) + (c.query || 0); };
/** 상한 넘칠 때 남길 순위(클수록 남김): 중요도 → 파일 아닌 종류 → 최근·접촉 수 */
const keepScore = (it) => (it.imp ? 2e15 : 0) + (it.k !== 'file' ? 1e15 : 0) + (it.last || 0) + Math.min(50, editsOf(it)) * 60_000; // 중요 > 파일 아닌 대상(DB·원격·저장소·서비스·산출물) > 최근·자주
/** 같은 폴더 구역 열쇠 */
/** 폴더 → 구역 폴더(윗 폴더로 묶음 — 구역 수를 줄인다): 프로젝트 안은 첫 조각, '~/' 는 세 조각, 절대 경로는 두 조각 */
export function topFolder(d) {
  const segs = String(d || '').split('/').filter(Boolean);
  if (!segs.length) return '';
  if (segs[0] === '~') return segs.slice(0, 3).join('/');
  if (/^[a-z]:$/i.test(segs[0]) || String(d).startsWith('/')) return (String(d).startsWith('/') ? '/' : '') + segs.slice(0, 2).join('/');
  return segs[0];
}
export function districtKey(it) {
  if (it.k === 'file' || it.k === 'output') return 'f:' + topFolder(it.d ?? dirOf(it.p || it.id)).toLowerCase();
  return '#' + it.k;
}
export function districtLabel(key) {
  if (key === '#repo') return t('boards.district.repo');
  if (key === '#db') return t('boards.district.db');
  if (key === '#remote') return t('boards.district.remote');
  if (key === '#service') return t('boards.district.service');
  if (key === '#more') return '…';
  const d = key.slice(2);
  if (!d) return t('boards.district.root');
  const s = d.split('/').filter(Boolean);
  return s.length > 2 ? '…/' + s.slice(-2).join('/') : d;
}

// ───────────── 장부 ─────────────
const newCnt = () => ({ read: 0, create: 0, modify: 0, delete: 0, query: 0, write: 0, push: 0 });

/**
 * 프로젝트별 대상 장부. 시각은 이벤트 ts(기록 시각)만 쓴다 → 라이브·재생·서버 재구성이 같은 답.
 * 서버 ArtifactStore 도 이 클래스로 7일 창 기록을 접어 스냅샷 items 를 만든다.
 */
export class ArtBook {
  constructor({ max = ART.MAX_ITEMS, windowMs = ART.WINDOW_MS } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.projects = new Map(); // pid → Map<id, item>
    this.seen = new Set();
    this._seenQ = [];
    this.version = 0;          // 바뀔 때마다 +1(렌더러 재배치 판단)
    this.defaultProject = '_'; // 프로젝트를 모르는 이벤트(단일 세션)
    this.nodeLabels = new Map(); // 노드 id → 라벨(스냅샷 nodes, 화면에 없는 노드의 이름)
  }
  reset() { this.projects.clear(); this.seen.clear(); this._seenQ = []; this.version++; }
  _map(pid) { let m = this.projects.get(pid); if (!m) { m = new Map(); this.projects.set(pid, m); } return m; }
  get(pid, id) { const m = this.projects.get(pid); return m ? m.get(id) || null : null; }
  items(pid) { const m = this.projects.get(pid); return m ? [...m.values()] : []; }
  shownItems(pid) { return this.items(pid).filter(isShown); }
  count(pid) { const m = this.projects.get(pid); return m ? m.size : 0; }

  _mark(key) {
    if (this.seen.has(key)) return false;
    this.seen.add(key); this._seenQ.push(key);
    if (this._seenQ.length > ART.SEEN_MAX) { for (const k of this._seenQ.splice(0, ART.SEEN_MAX / 4)) this.seen.delete(k); }
    return true;
  }

  /** 서버 스냅샷 items 를 넣는다(replace 면 그 프로젝트를 비우고). 기록의 toolUseId 는 중복 방지에 등록 */
  load(pid, items = [], { replace = true, nodes = null } = {}) {
    const m = this._map(pid);
    if (replace) m.clear();
    for (const it of items || []) {
      if (!it || !it.id || !ART_KINDS.includes(it.k)) continue;
      const c = { ...it, cnt: { ...newCnt(), ...(it.cnt || {}) }, who: (it.who || []).map((w) => ({ ...w })), log: (it.log || []).map((l) => ({ ...l })) };
      m.set(c.id, c);
      for (const l of c.log) if (l.tu) this._mark(l.tu + '|' + c.id);
    }
    if (nodes) for (const [id, lab] of Object.entries(nodes)) this.nodeLabels.set(id, lab);
    this.version++;
  }

  /**
   * 이벤트 하나 반영. tool-end(성공)의 art 만 장부를 바꾼다(실패한 Edit 은 대상이 아님). tool-start 의 art 는 연출용(반환 'start').
   * @returns {{pid, changes:[{kind:'new'|'touch'|'del'|'read', item, ref}], start?:true}|null}
   */
  apply(ev, pid = null) {
    if (!ev || !Array.isArray(ev.art) || !ev.art.length) return null;
    const p = pid || ev.projectId || this.defaultProject;
    if (ev.type === 'tool-start') return { pid: p, start: true, changes: ev.art.map((ref) => ({ kind: 'start', item: this.get(p, ref.id), ref })) };
    if (ev.type !== 'tool-end' || ev.ok === false) return null;
    const t = Date.parse(ev.ts) || 0;
    const changes = [];
    for (const ref of ev.art) {
      const r = this.touch(p, ref, t, ev.nodeId, ev.toolUseId);
      if (r) changes.push(r);
    }
    return changes.length ? { pid: p, changes } : null;
  }

  /** 대상 접촉 하나(서버 재구성·웹 공용). 읽기는 이미 있는 대상만 갱신(없는 대상을 만들지 않음) */
  touch(pid, ref, t, nodeId, tu = null) {
    if (!ref || !ref.id || !ART_KINDS.includes(ref.k) || !ART_VERBS.includes(ref.v)) return null;
    if (tu && !this._mark(tu + '|' + ref.id)) return null;
    const m = this._map(pid);
    let it = m.get(ref.id);
    const v = ref.v;
    if (!it) {
      if (v === 'read') return null;
      it = { id: ref.id, k: ref.k, n: ref.n || ref.id, p: ref.p ?? null, d: ref.d ?? (ref.k === 'file' || ref.k === 'output' ? dirOf(ref.p || ref.id) : null),
        first: t, last: t, cnt: newCnt(), sz: 0, rows: null, del: 0, x: null, xAt: 0, imp: null, coll: [], who: [], log: [], est: ref.est ? 1 : 0 };
      m.set(it.id, it);
    }
    const wasShown = isShown(it);
    it.cnt[v] = (it.cnt[v] || 0) + 1;
    if (t >= (it.last || 0)) it.last = t;
    if (t && (!it.first || t < it.first)) it.first = t;
    if (ref.n && !it.n) it.n = ref.n;
    if (ref.sz) it.sz = (it.sz || 0) + ref.sz;
    if (ref.rows != null) it.rows = ref.rows;
    if (v === 'delete') it.del = 1;
    else if (v === 'create' || v === 'modify' || v === 'write') it.del = 0;
    if (ref.x) { it.x = ref.x; it.xAt = t; }
    if (ref.imp && (!it.imp || ART_IMP.indexOf(ref.imp) < ART_IMP.indexOf(it.imp))) it.imp = ref.imp;
    if (ref.coll) for (const c of ref.coll) if (!it.coll.includes(c) && it.coll.length < 6) it.coll.push(c);
    if (!ref.est && ART_WRITE_VERBS.has(v)) it.est = 0;
    if (nodeId) {
      let w = it.who.find((x) => x.node === nodeId);
      if (!w) { w = { node: nodeId, c: 0, last: 0, v }; it.who.push(w); }
      w.c++; if (t >= w.last) { w.last = t; w.v = v; }
      if (it.who.length > ART.WHO_MAX) { it.who.sort((a, b) => b.last - a.last); it.who.length = ART.WHO_MAX; }
    }
    const log = { t, node: nodeId || null, v };
    if (ref.sz) log.sz = ref.sz;
    if (ref.rows != null) log.rows = ref.rows;
    if (ref.x) log.x = ref.x;
    if (ref.c) log.c = ref.c;
    if (tu) log.tu = tu;
    it.log.push(log);
    if (it.log.length > ART.LOG_MAX) it.log.splice(0, it.log.length - ART.LOG_MAX);
    if (m.size > this.max) this._evict(m);
    this.version++;
    const nowShown = isShown(it);
    const kind = v === 'read' ? 'read' : v === 'delete' ? 'del' : !wasShown && nowShown ? 'new' : 'touch';
    return { kind, item: it, ref };
  }

  _evict(m) {
    const arr = [...m.values()].sort((a, b) => keepScore(a) - keepScore(b));
    for (const it of arr.slice(0, m.size - this.max)) m.delete(it.id);
  }

  /** 창(7일) 밖 대상 정리. 지운 수 */
  prune(nowMs) {
    let n = 0;
    const lo = nowMs - this.windowMs;
    for (const m of this.projects.values()) for (const [id, it] of m) if ((it.last || 0) < lo) { m.delete(id); n++; }
    if (n) this.version++;
    return n;
  }

  /** 스냅샷용 배열(최근순, 상한) */
  snapshot(pid, { limit = this.max } = {}) {
    return this.items(pid).sort((a, b) => b.last - a.last).slice(0, limit);
  }

  /** 노드가 만진 대상 열쇠(발자국 강조): Set<id> */
  touchedBy(pid, nodeId) {
    const s = new Set();
    for (const it of this.items(pid)) if (it.who.some((w) => w.node === nodeId)) s.add(it.id);
    return s;
  }
}

/** 종류별 수(실황·보고·시험) */
export function countKinds(items) {
  const o = {};
  for (const it of items || []) o[it.k] = (o[it.k] || 0) + 1;
  return o;
}

// ───────────── 배치(섬 로컬 격자, 결정적·안정적) ─────────────
// 칸 좌표(정수) → 섬 로컬 (x, z) = 칸 × CELL. 원점 = 섬 중심(흐름: 섬 상자 가운데, 단일 세션: 노드 경계 가운데).
// 구역(폴더·종류) 기준점 = 사각 나선(0,0),(1,0),(1,1),(0,1),(-1,1)… 의 k번째 × PITCH(첫 등장 순서),
// 대상 칸 = 구역 기준점 둘레 나선에서 첫 빈 칸(첫 등장 순서). 이미 놓인 대상은 움직이지 않는다(빠질 때만 칸이 빈다).
// 다음 칸: 오른쪽 1, 위 1, 왼쪽 2, 아래 2, 오른쪽 3 … (상태를 이어서 늘림)
const SPIRAL = [[0, 0]];
const SP = { x: 0, y: 0, dir: 0, step: 1, left: 1, turns: 0 };
const SPD = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function spiralAt(n) {
  while (SPIRAL.length <= n) {
    SP.x += SPD[SP.dir][0]; SP.y += SPD[SP.dir][1];
    SPIRAL.push([SP.x, SP.y]);
    if (--SP.left === 0) {
      SP.dir = (SP.dir + 1) % 4;
      if (++SP.turns % 2 === 0) SP.step++;
      SP.left = SP.step;
    }
  }
  return SPIRAL[n];
}
export { spiralAt };
/** 들어갈 순서: 첫 접촉 시각 → 열쇠(결정적) */
const placeOrder = (a, b) => (a.first || 0) - (b.first || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class ArtLayout {
  constructor({ folderMax = ART.FOLDER_MAX } = {}) {
    this.folderMax = folderMax;
    this.proj = new Map(); // pid → {cells:Map<'i,j',id>, at:Map<id,[i,j]>, dist:Map<key,{idx, ai, aj}>, dn}
  }
  reset(pid = null) { if (pid == null) this.proj.clear(); else this.proj.delete(pid); }
  _p(pid) { let P = this.proj.get(pid); if (!P) { P = { cells: new Map(), at: new Map(), dist: new Map(), dn: 0, ver: -1 }; this.proj.set(pid, P); } return P; }

  /**
   * 그 프로젝트의 보이는 대상들로 배치를 맞춘다(새 대상만 자리를 얻고, 빠진 대상의 칸은 빈다).
   * @returns {{pos:Map<id,{x,z,i,j,dk}>, zones:[{key,label,x0,z0,x1,z1,n}], bounds:{x0,z0,x1,z1}|null}}
   */
  sync(pid, items) {
    const P = this._p(pid);
    const want = new Map(items.map((it) => [it.id, it]));
    for (const [id, ij] of P.at) if (!want.has(id)) { P.at.delete(id); P.cells.delete(ij[0] + ',' + ij[1]); }
    const fresh = items.filter((it) => !P.at.has(it.id)).sort(placeOrder);
    for (const it of fresh) {
      let dk = districtKey(it);
      let d = P.dist.get(dk);
      if (!d) {
        if (P.dn >= this.folderMax && dk.startsWith('f:')) { dk = '#more'; d = P.dist.get(dk); }
        if (!d) { const [ai, aj] = spiralAt(P.dn); d = { idx: P.dn, ai: ai * ART.PITCH, aj: aj * ART.PITCH, label: dk.startsWith('f:') ? topFolder(it.d ?? dirOf(it.p || it.id)) || t('boards.district.root') : districtLabel(dk) }; P.dist.set(dk, d); P.dn++; }
      }
      for (let j = 0; j < 4000; j++) {
        const [di, dj] = spiralAt(j);
        const i = d.ai + di, k = d.aj + dj, key = i + ',' + k;
        if (!P.cells.has(key)) { P.cells.set(key, it.id); P.at.set(it.id, [i, k]); break; }
      }
    }
    const C = ART.CELL;
    const pos = new Map();
    const zm = new Map();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const it of items) {
      const ij = P.at.get(it.id); if (!ij) continue;
      let dk = districtKey(it); if (!P.dist.has(dk)) dk = '#more';
      const x = ij[0] * C, z = ij[1] * C;
      pos.set(it.id, { x, z, i: ij[0], j: ij[1], dk });
      let zn = zm.get(dk);
      if (!zn) { zn = { key: dk, label: P.dist.get(dk)?.label || districtLabel(dk), x0: x, z0: z, x1: x, z1: z, n: 0, ax: (P.dist.get(dk)?.ai || 0) * C, az: (P.dist.get(dk)?.aj || 0) * C }; zm.set(dk, zn); }
      zn.x0 = Math.min(zn.x0, x); zn.z0 = Math.min(zn.z0, z); zn.x1 = Math.max(zn.x1, x); zn.z1 = Math.max(zn.z1, z); zn.n++;
      x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    const h = C * 0.6;
    const zones = [...zm.values()].map((z) => ({ ...z, x0: z.x0 - h, z0: z.z0 - h, x1: z.x1 + h, z1: z.z1 + h }));
    const bounds = pos.size ? { x0: x0 - C, z0: z0 - C, x1: x1 + C, z1: z1 + C } : null;
    return { pos, zones, bounds };
  }
}

// ───────────── 연출 큐 ─────────────
export const FX_DUR = { packet: 0.9, read: 1.2, rise: 0.9, pulse: 1.1, collapse: 1.3, alarm: 2.6, warn: 1.6, absorb: 1.5, dbw: 1.4, lit: 4 };
export const FX_MAX = 160;
/**
 * 장부 반영 결과 → 연출. 시계 = 렌더러 초(performance.now/1000), 배속이면 ÷√배속.
 * 항목 {kind, pid, id, node, t0, dur, amp, x}. 모든 접촉은 'lit'(점등, 4초 감쇠)도 남긴다 — 평소엔 가라앉고 손댈 때만 밝음.
 */
export class ArtFx {
  constructor() { this.list = []; this.acts = new ArtActs(); } // acts = 상호작용 연출(읽기 스캔·건설·편집·파쇄·레이더·발사…)
  clear() { this.list.length = 0; this.acts.clear(); }
  _push(e) { this.list.push(e); if (this.list.length > FX_MAX) this.list.splice(0, this.list.length - FX_MAX); }
  /** ArtBook.apply 의 반환값을 받는다 */
  note(res, nodeId, nowSec, speed = 1, tu = null) {
    if (!res) return;
    this.acts.fromRes(res, nodeId, nowSec, speed, tu);
    const k = 1 / Math.sqrt(Math.max(1, speed || 1));
    for (const ch of res.changes) {
      const ref = ch.ref, id = ref.id, pid = res.pid;
      const base = { pid, id, node: nodeId || null, t0: nowSec };
      if (ch.kind === 'start') {
        if (ref.v === 'read') { if (ch.item) { this._push({ ...base, kind: 'read', dur: FX_DUR.read * k }); this._push({ ...base, kind: 'lit', dur: FX_DUR.lit * k * 0.5, amp: 0.5 }); } }
        else { this._push({ ...base, kind: 'packet', dur: FX_DUR.packet * k, amp: ref.v === 'push' ? 3 : ref.v === 'query' ? 1 : 2, v: ref.v }); this._push({ ...base, kind: 'lit', dur: FX_DUR.lit * k, amp: 1 }); }
        continue;
      }
      if (ch.kind === 'read') continue;
      this._push({ ...base, kind: 'lit', dur: FX_DUR.lit * k, amp: 1 });
      if (ch.kind === 'new') this._push({ ...base, kind: 'rise', dur: FX_DUR.rise * k });
      else if (ch.kind === 'del') this._push({ ...base, kind: 'collapse', dur: FX_DUR.collapse * k });
      else this._push({ ...base, kind: 'pulse', dur: FX_DUR.pulse * k, amp: Math.min(1, Math.log10(1 + (ref.sz || 1)) / 2.5) });
      if (ref.k === 'db' && ref.v === 'write') this._push({ ...base, kind: 'dbw', dur: FX_DUR.dbw * k });
      if (ref.k === 'repo' && ref.v === 'push') this._push({ ...base, kind: 'absorb', dur: FX_DUR.absorb * k, amp: Math.min(8, Math.max(2, ref.c || 3)) });
      if (ref.x) this._push({ ...base, kind: ref.x === 'overwrite' ? 'warn' : 'alarm', dur: (ref.x === 'overwrite' ? FX_DUR.warn : FX_DUR.alarm) * k, x: ref.x });
    }
  }
  step(nowSec) { if (this.list.length) this.list = this.list.filter((e) => nowSec - e.t0 < e.dur); this.acts.step(nowSec); }
  get active() { return this.list.length > 0 || this.acts.active; }
}

// ───────────── 그릴 도형(저휘도 선 위주 · 종류별 실루엣) ─────────────
// 색 열쇠: 렌더러가 테마별로 한 번 풀어 둔다. 종류 색은 채도를 크게 낮춘 색조만(구별은 모양으로), 빨강은 파괴적 경보 전용
export const ART_KEYS = ['file', 'output', 'repo', 'db', 'remote', 'service', 'write', 'read', 'alarm', 'imp', 'zone', 'del', 'new', 'warn'];
const KI = Object.fromEntries(ART_KEYS.map((k, i) => [k, i]));
export function artKeyColor(key, isLight = false) {
  const L = isLight;
  switch (key) {
    case 'file': return L ? '#334155' : '#a7b4c8';
    case 'output': return L ? '#2f4a48' : '#a9c4bf';
    case 'repo': return L ? '#3f3a58' : '#b9b3d0';
    case 'db': return L ? '#28485a' : '#a3bccb';
    case 'remote': return L ? '#4a3a4f' : '#c4b0c8';
    case 'service': return L ? '#3a3f5c' : '#b0b6d2';
    case 'write': return L ? '#b45309' : '#fdba74';   // 에이전트 → 대상 빔(늘 바닥층보다 밝게)
    case 'read': return L ? '#0369a1' : '#7dd3fc';
    case 'alarm': return L ? '#dc2626' : '#f87171';   // 빨강 = 파괴적 경보 전용
    case 'imp': return L ? '#92400e' : '#e8c977';
    case 'zone': return L ? '#64748b' : '#8b97aa';
    case 'del': return L ? '#94a3b8' : '#5b6474';
    case 'new': return L ? '#166534' : '#86efac';
    case 'warn': return L ? '#b45309' : '#fbbf24';
    default: return L ? '#334155' : '#cbd5e1';
  }
}
export const ARTGEO = { BOXES: 1400, CYLS: 128, LINES: 16000, DOTS: 900, LABELS: 14 };

/** 재사용 버퍼(프레임마다 새 배열 없음) */
export class ArtGeo {
  constructor() {
    this.B = new Float32Array(ARTGEO.BOXES * 6); this.BC = new Uint8Array(ARTGEO.BOXES); this.BA = new Float32Array(ARTGEO.BOXES); this.BI = new Array(ARTGEO.BOXES);
    this.Y = new Float32Array(ARTGEO.CYLS * 5); this.YC = new Uint8Array(ARTGEO.CYLS); this.YA = new Float32Array(ARTGEO.CYLS); this.YI = new Array(ARTGEO.CYLS);
    this.L = new Float32Array(ARTGEO.LINES * 6); this.LC = new Uint8Array(ARTGEO.LINES); this.LA = new Float32Array(ARTGEO.LINES); this.LW = new Uint8Array(ARTGEO.LINES);
    this.D = new Float32Array(ARTGEO.DOTS * 4); this.DC = new Uint8Array(ARTGEO.DOTS); this.DA = new Float32Array(ARTGEO.DOTS);
    this.labels = [];
    this.nb = 0; this.ny = 0; this.nl = 0; this.nd = 0;
    this.ka = 1; // 지금 그리는 프로젝트의 투명도 배율(프로젝트 페이드) — 아래 그리기 함수가 모두 곱한다
  }
  begin() { this.nb = this.ny = this.nl = this.nd = 0; this.labels.length = 0; this.ka = 1; }
  /** 프로젝트 하나 그리기 시작: 투명도 배율(env.pidAlpha) — 0 이면 그 프로젝트는 건너뛴다(false) */
  pidStart(env, pid) { this.ka = env && env.pidAlpha ? env.pidAlpha(pid) : 1; return this.ka > 0; }
  box(x, y, z, sx, sy, sz, c, a, ref) { a *= this.ka; if (this.nb >= ARTGEO.BOXES || a <= 0.01) return; const i = this.nb++, o = i * 6; const B = this.B; B[o] = x; B[o + 1] = y; B[o + 2] = z; B[o + 3] = sx; B[o + 4] = sy; B[o + 5] = sz; this.BC[i] = c; this.BA[i] = Math.min(1, a); this.BI[i] = ref || null; }
  cyl(x, y, z, r, h, c, a, ref) { a *= this.ka; if (this.ny >= ARTGEO.CYLS || a <= 0.01) return; const i = this.ny++, o = i * 5; const Y = this.Y; Y[o] = x; Y[o + 1] = y; Y[o + 2] = z; Y[o + 3] = r; Y[o + 4] = h; this.YC[i] = c; this.YA[i] = Math.min(1, a); this.YI[i] = ref || null; }
  line(x0, y0, z0, x1, y1, z1, c, a, w = 1) { a *= this.ka; if (this.nl >= ARTGEO.LINES || a <= 0.008) return; const i = this.nl++, o = i * 6; const L = this.L; L[o] = x0; L[o + 1] = y0; L[o + 2] = z0; L[o + 3] = x1; L[o + 4] = y1; L[o + 5] = z1; this.LC[i] = c; this.LA[i] = Math.min(1, a); this.LW[i] = w; }
  dot(x, y, z, s, c, a) { a *= this.ka; if (this.nd >= ARTGEO.DOTS || a <= 0.01) return; const i = this.nd++, o = i * 4; const D = this.D; D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = s; this.DC[i] = c; this.DA[i] = Math.min(1, a); }
  /** 수평 고리(가운데 x,y,z · 반지름 r). dash = 그 구간마다 하나 건너뜀(점선), ph = 회전 위상 */
  ring(x, y, z, r, c, a, seg = 20, dash = false, ph = 0) { for (let s = 0; s < seg; s++) { if (dash && s % 2) continue; const a0 = ph + (s / seg) * Math.PI * 2, a1 = ph + ((s + 1) / seg) * Math.PI * 2; this.line(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, c, a); } }
  /** 세로 고리(xy 평면, 화면 쪽을 봄) */
  vring(x, y, z, r, c, a, seg = 20, dash = false, ph = 0, sx = 1) { for (let s = 0; s < seg; s++) { if (dash && s % 2) continue; const a0 = ph + (s / seg) * Math.PI * 2, a1 = ph + ((s + 1) / seg) * Math.PI * 2; this.line(x + Math.cos(a0) * r * sx, y + Math.sin(a0) * r, z, x + Math.cos(a1) * r * sx, y + Math.sin(a1) * r, z, c, a); } }
  rect(x0, y, z0, x1, z1, c, a) { this.line(x0, y, z0, x1, y, z0, c, a); this.line(x1, y, z0, x1, y, z1, c, a); this.line(x1, y, z1, x0, y, z1, c, a); this.line(x0, y, z1, x0, y, z0, c, a); }
  label(x, y, z, text, cls, key, alpha) { alpha *= this.ka; if (alpha > 0.01 && this.labels.length < ARTGEO.LABELS) this.labels.push({ x, y, z, text, cls, key, alpha }); }
}

const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(1 - k, 3));
/** 대상 판 높이: 크기(누적 변경 줄 log)·접촉 수 — 0.08～0.9(낮은 판) */
export const blockHeight = (it) => Math.min(0.9, 0.08 + 0.1 * Math.log2(1 + editsOf(it)) + 0.04 * Math.log2(1 + (it.sz || 0)));
/** DB 수위 0.12～1: 쓰기 수·행 수(log) */
export const dbLevel = (it) => Math.max(0.12, Math.min(1, (Math.log10(1 + (it.cnt?.write || 0) * 3 + (it.rows || 0) / 50)) / 2.6));
/** 파일 하위 종류(실루엣 무늬): code · doc · data · image · plan(계획 문서 — 설계도 윤곽) */
export function fileSub(it) {
  const n = String(it.n || it.p || it.id || '').toLowerCase();
  if (/\.(md|markdown|txt|rst|adoc)$/.test(n)) return /(plan|계획|todo|backlog|roadmap|checklist|체크)/.test(n) ? 'plan' : 'doc';
  if (/\.(json|jsonl|csv|tsv|ya?ml|toml|xml|ini|env|parquet|sql)$/.test(n) || /(^|\/)\.env/.test(n)) return 'data';
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(n)) return 'image';
  return 'code';
}
/** 섬 슈퍼타원(지수 4) 안쪽 판정 — 안전하게 지수 3·여유 0.86 */
export const inIsland = (x, z, hw, hd, m = 0.86) => Math.pow(Math.abs(x) / (hw * m), 3) + Math.pow(Math.abs(z) / (hd * m), 3) <= 1;

/** 표시 양식(⚙): bright 0～1(기본 0.35), fill 'line'(선만) | 'soft'(옅은 채움, 기본) */
export const ART_STYLE_DEFAULT = { bright: 0.35, fill: 'soft' };

/**
 * 장부 + 배치 + 연출 → 세계 좌표 도형.
 * env = { anchor(pid) → {x,z,k}|null, nodePos(id) → {x,y,z}|null, nowMs(데이터 시계), reduced, foot: {pid,node,set}|null(발자국·호버 초점),
 *         hover: {pid,id}|null(선택), y(바닥), style {bright, fill}, isLight, cellPx(pid) → 한 칸 화면 px(멀면 LOD), avoid: [{x,z,r}](노드 아래 비움) }
 * lay = Map<pid, 배치>(ArtState.lay — 집계 모드면 구역 묶음 항목 'zone')
 */
export function artGeometry(book, lay, fx, nowSec, env, geo = new ArtGeo()) {
  geo.begin();
  const Y0 = env.y ?? ART.FLOOR_Y;
  const nowMs = env.nowMs || Date.now();
  const st = env.style || ART_STYLE_DEFAULT;
  const B0 = Math.max(0, Math.min(1, st.bright ?? 0.35));
  const LINE_A = (0.05 + 0.5 * B0) * (env.isLight ? 1.7 : 1);                                   // 기본 0.225(측정: 켬/끔 평균 밝기 상승 ≤5%)
  const FILL_A = st.fill === 'line' || env.isLight ? 0 : 0.005 + 0.07 * B0; // 기본 0.03, 라이트는 채움 없음
  // 점등(최근 활동): 대상마다 lit 0～1, 동시 상한 ART.LIT_MAX
  const fxBy = new Map(), litBy = new Map();
  for (const e of fx ? fx.list : []) {
    const key = e.pid + '|' + e.id;
    (fxBy.get(key) || fxBy.set(key, []).get(key)).push(e);
    if (e.kind === 'lit') { const l = Math.max(0, 1 - (nowSec - e.t0) / e.dur) * (e.amp || 1); if (l > (litBy.get(key) || 0)) litBy.set(key, l); }
  }
  if (litBy.size > ART.LIT_MAX) { const keep = new Set([...litBy].sort((a, b) => b[1] - a[1]).slice(0, ART.LIT_MAX).map((x) => x[0])); for (const k of [...litBy.keys()]) if (!keep.has(k)) litBy.delete(k); }
  const avoid = env.avoid || [];
  const near = (x, z) => { for (const a of avoid) { const dx = x - a.x, dz = z - a.z; if (dx * dx + dz * dz < a.r * a.r) return true; } return false; };
  let labelBudget = env.labels === false ? 0 : ARTGEO.LABELS - 3;
  // 상호작용 연출: 연출이 걸린 대상만 위치를 남겨 두었다가 끝에서 그림(옛 패킷·읽기 선·솟음/맥동 사각 파문은 이것이 대신함)
  const AC = fx && fx.acts && fx.acts.list.length ? fx.acts : null;
  const AP = env._ap || (env._ap = new ActPos()); AP.begin();
  const want = AC ? AC.keys(book, zoneKeyOf) : null;
  for (const [pid, L] of lay) {
    const a = env.anchor(pid);
    if (!a || !L.bounds || !geo.pidStart(env, pid)) continue; // 숨은 프로젝트는 건너뜀, 페이드 중이면 배율
    const ax = a.x, az = a.z, sk = a.k || 1;
    const C = ART.CELL * sk;
    if (AC) { const B = L.bounds; AP.areas.set(pid, { x: ax + ((B.x0 + B.x1) / 2) * sk, y: Y0, z: az + ((B.z0 + B.z1) / 2) * sk, r: Math.max(B.x1 - B.x0, B.z1 - B.z0) * 0.5 * sk + C }); }
    const px = env.cellPx ? env.cellPx(pid) : 20;  // 한 칸의 화면 크기
    const far = px < ART.LOD_PX;                       // 멀리: 폴더 묶음 외곽선만
    const detail = px >= ART.DETAIL_PX;                // 가까울 때만 무늬(하위 종류)·옆 모서리
    const foot = env.foot && env.foot.pid === pid ? env.foot.set : null;
    const zones = L.zones.map((z) => ({ ...z, x0: z.x0 * sk, z0: z.z0 * sk, x1: z.x1 * sk, z1: z.z1 * sk, ax: z.ax * sk, az: z.az * sk }));
    // 구역(폴더 묶음) 외곽선 — 늘, 아주 옅게. 이름은 큰 구역 4개만(멀면 생략)
    for (const z of zones) geo.rect(ax + z.x0, Y0, az + z.z0, ax + z.x1, az + z.z1, KI.zone, LINE_A * 0.45 * (foot ? 0.5 : 1));
    if (!far) for (const z of [...zones].sort((p, q) => q.n - p.n).slice(0, 4)) if (labelBudget > 0) { geo.label(ax + (z.x0 + z.x1) / 2, Y0 + 0.1, az + z.z1 + 0.25, z.label, 'art-zone', 'zone', 0.45); labelBudget--; }
    for (const [id, p] of L.pos) {
      const zoneItem = id.startsWith('#zone:');
      const it = zoneItem ? L.agg && L.agg.get(id) : book.get(pid, id);
      if (!it) continue;
      const x = ax + p.x * sk, z = az + p.z * sk;
      const fr = freshness(nowMs - (it.last || 0));
      const key = pid + '|' + id;
      const lit = litBy.get(key) || 0;
      const sel = env.hover && env.hover.pid === pid && env.hover.id === id;
      let dim = foot ? (foot.has(id) ? 1.6 : 0.3) : 1;
      if (near(x, z)) dim *= 0.35; // 에이전트 노드 아래는 비움(층 분리)
      const la = Math.min(1, (LINE_A * (0.45 + 0.55 * fr) * dim) + (0.85 - LINE_A) * Math.max(lit, sel ? 0.7 : 0));
      const fa = (FILL_A * fr * dim) + 0.3 * lit * (env.isLight ? 0 : 1);
      const ref = zoneItem ? null : { pid, id };
      const fxs = fxBy.get(key) || null;
      const R = want && want.has(key) ? AP.put(key, x, Y0 + 0.4, z, Y0 + 0.3, Y0, C) : null; // 연출 기준점
      let hk = 1, pulse = 0, gone = 0, spin = 0, rise = 0;
      if (fxs) for (const e of fxs) {
        const k = (nowSec - e.t0) / e.dur;
        if (e.kind === 'rise') { hk = Math.min(hk, ease(k)); rise = Math.max(rise, 1 - k); }
        else if (e.kind === 'pulse') pulse = Math.max(pulse, (env.reduced ? 0.3 : Math.sin(Math.min(1, k) * Math.PI)) * (0.35 + 0.65 * (e.amp || 0.3)));
        else if (e.kind === 'collapse') gone = Math.max(gone, ease(k));
        else if (e.kind === 'dbw' || e.kind === 'absorb') spin = Math.max(spin, 1 - k);
      }
      const col = it.del ? KI.del : KI[it.k] ?? KI.file;
      if (far) { // 멀리: 대상은 점 하나(구역 외곽선이 주인공), 중요·점등만 조금 밝게
        if (lit > 0.05 || it.imp) geo.dot(x, Y0 + 0.2, z, 0.35 * sk + 0.2, it.imp ? KI.imp : col, Math.max(la, 0.5 * lit + 0.2));
        continue;
      }
      if (it.k === 'zone') { // 집계(폴더 LOD): 묶음 판 하나 — 외곽선 + 대상 수만큼 가는 줄
        const w = C * 0.9, h = Math.min(1.2, 0.1 + 0.12 * Math.log2(1 + it.count));
        geo.rect(x - w / 2, Y0 + h, z - w / 2, x + w / 2, z + w / 2, KI.file, la);
        geo.rect(x - w / 2, Y0, z - w / 2, x + w / 2, z + w / 2, KI.file, la * 0.5);
        for (let q = 1; q < Math.min(5, 1 + Math.log2(1 + it.count)); q++) geo.line(x - w / 2, Y0 + (h * q) / 5, z + w / 2, x + w / 2, Y0 + (h * q) / 5, z + w / 2, KI.file, la * 0.6);
        if (fa > 0.01) geo.box(x, Y0 + h / 2, z, w, h, w, KI.file, fa, null);
        if (labelBudget > 0 && px > 10) { geo.label(x, Y0 + h + 0.4, z, `${it.n} ${it.count}`, 'art-zone', 'zone', 0.55); labelBudget--; }
        if (R) R.top = Y0 + h;
        continue;
      }
      if (it.k === 'file') {
        // 낮은 판(plate): 높이 = 크기. 무늬로 하위 종류 구별(코드 가로줄·문서 접힌 귀·데이터 격자·이미지 대각 십자·계획 설계도)
        const h0 = it.del ? 0.03 : blockHeight(it);
        const h = Math.max(0.03, (gone ? h0 * (1 - gone) : h0) * hk * (1 + 0.6 * pulse));
        const w = C * 0.74, w2 = w / 2, yt = Y0 + h;
        const c = gone ? KI.del : col, A = la + pulse * 0.3;
        const sub = fileSub(it);
        if (sub === 'doc') { // 귀퉁이 접힌 종이
          const f = w * 0.3;
          geo.line(x - w2, yt, z - w2, x + w2 - f, yt, z - w2, c, A); geo.line(x + w2 - f, yt, z - w2, x + w2, yt, z - w2 + f, c, A);
          geo.line(x + w2, yt, z - w2 + f, x + w2, yt, z + w2, c, A); geo.line(x + w2, yt, z + w2, x - w2, yt, z + w2, c, A); geo.line(x - w2, yt, z + w2, x - w2, yt, z - w2, c, A);
          geo.line(x + w2 - f, yt, z - w2, x + w2 - f, yt, z - w2 + f, c, A * 0.8); geo.line(x + w2 - f, yt, z - w2 + f, x + w2, yt, z - w2 + f, c, A * 0.8);
        } else geo.rect(x - w2, yt, z - w2, x + w2, z + w2, c, A);
        if (detail && h > 0.12) { geo.line(x - w2, Y0, z + w2, x - w2, yt, z + w2, c, A * 0.6); geo.line(x + w2, Y0, z + w2, x + w2, yt, z + w2, c, A * 0.6); }
        const m = A * 0.65;
        if (!detail) { /* 중간 거리: 판 윤곽만 */ } else if (sub === 'code') for (let q = 1; q <= 3; q++) geo.line(x - w2 * 0.7, yt, z - w2 + (w * q) / 4, x + w2 * (q === 2 ? 0.2 : 0.6), yt, z - w2 + (w * q) / 4, c, m);
        else if (sub === 'data') { geo.line(x, yt, z - w2, x, yt, z + w2, c, m); geo.line(x - w2, yt, z, x + w2, yt, z, c, m); geo.line(x - w2, yt, z - w2 / 2, x + w2, yt, z - w2 / 2, c, m * 0.6); geo.line(x - w2 / 2, yt, z - w2, x - w2 / 2, yt, z + w2, c, m * 0.6); }
        else if (sub === 'image') { geo.line(x - w2, yt, z - w2, x + w2, yt, z + w2, c, m); geo.line(x + w2, yt, z - w2, x - w2, yt, z + w2, c, m); }
        else if (sub === 'plan') { for (let q = 1; q < 4; q++) { geo.line(x - w2 + (w * q) / 4, yt, z - w2, x - w2 + (w * q) / 4, yt, z + w2, c, m * 0.5); geo.line(x - w2, yt, z - w2 + (w * q) / 4, x + w2, yt, z - w2 + (w * q) / 4, c, m * 0.5); }
          const t = w * 0.18; for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { geo.line(x + sx * w2, yt, z + sz * w2, x + sx * (w2 + t), yt, z + sz * w2, c, A); geo.line(x + sx * w2, yt, z + sz * w2, x + sx * w2, yt, z + sz * (w2 + t), c, A); } }
        if (fa > 0.01) geo.box(x, Y0 + h / 2, z, w, h, w, c, fa, ref);
        if (gone && !env.reduced) for (let q = 0; q < 4; q++) geo.dot(x + (q - 1.5) * 0.3 * sk, Y0 + 0.9 * (1 - gone) + 0.1, z + ((q * 37) % 5 - 2) * 0.12, 0.16, KI.del, 0.7 * (1 - gone));
        if (R) R.top = yt;
      } else if (it.k === 'output') {
        // 진열 액자: 받침대 + 세로 판(화면 쪽) + 확장자 글리프, 생성 순간 위로 솟아 반짝
        const w = C * 0.7, H = 1.4 * sk + 0.5, lift = rise * 1.2;
        const yb = Y0 + 0.08 + lift, c = col;
        geo.rect(x - w * 0.35, Y0 + 0.05, z - w * 0.18, x + w * 0.35, z + w * 0.18, c, la * 0.8);
        geo.line(x, Y0 + 0.05, z, x, yb, z, c, la * 0.8);
        const fx0 = x - w / 2, fx1 = x + w / 2;
        geo.line(fx0, yb, z, fx1, yb, z, c, la); geo.line(fx1, yb, z, fx1, yb + H, z, c, la); geo.line(fx1, yb + H, z, fx0, yb + H, z, c, la); geo.line(fx0, yb + H, z, fx0, yb, z, c, la);
        geo.line(fx0 + w * 0.12, yb + H * 0.12, z, fx1 - w * 0.12, yb + H * 0.12, z, c, la * 0.5); geo.line(fx1 - w * 0.12, yb + H * 0.12, z, fx1 - w * 0.12, yb + H * 0.88, z, c, la * 0.5);
        if (rise > 0 && !env.reduced) geo.dot(fx1, yb + H, z, 0.35, KI.new, rise);
        if ((lit > 0.05 || sel || px > 16) && labelBudget > 0 && !String(id).startsWith('artifact:')) { geo.label(x, yb + H + 0.25, z, (extOf(it.n || it.id).slice(1) || 'out').toUpperCase(), 'art-ext', 'output', Math.max(0.45, la)); labelBudget--; }
        if (R) { R.y = yb + H * 0.25; R.top = yb + H; }
      } else if (it.k === 'db') {
        // 세로 원기둥 와이어(이중선) + 쌓인 원판 고리(컬렉션 수, 최대 6) + 쓰기 수위선. 쓰기 순간 고리가 천천히 돎
        const r = C * 0.42, H = 1.8 * Math.max(0.6, sk), c = col;
        const ph = spin * 1.6;
        geo.ring(x, Y0 + H, z, r, c, la, 18); geo.ring(x, Y0 + H, z, r * 0.88, c, la * 0.6, 18);
        geo.ring(x, Y0 + 0.02, z, r, c, la * 0.7, 18);
        for (let q = 0; q < 4; q++) { const t = (q / 4) * Math.PI * 2 + 0.4; geo.line(x + Math.cos(t) * r, Y0, z + Math.sin(t) * r, x + Math.cos(t) * r, Y0 + H, z + Math.sin(t) * r, c, la * 0.7); }
        const nd = Math.max(1, Math.min(6, (it.coll || []).length || 1));
        for (let q = 0; q < nd; q++) { const yy = Y0 + 0.15 + (q * (H * 0.6)) / nd; geo.ring(x, yy, z, r * 1.08, c, la * 0.55, 14, false, ph * (q % 2 ? -1 : 1)); geo.line(x + Math.cos(ph) * r * 1.08, yy, z + Math.sin(ph) * r * 1.08, x + Math.cos(ph) * r * 1.3, yy, z + Math.sin(ph) * r * 1.3, c, la * 0.6); }
        geo.ring(x, Y0 + H * dbLevel(it), z, r * 0.95, c, Math.min(1, la * 1.2 + pulse * 0.4), 18);
        if (fa > 0.01) geo.box(x, Y0 + (H * dbLevel(it)) / 2, z, r * 1.6, H * dbLevel(it), r * 1.6, c, fa * 0.8, ref);
        if (R) R.top = Y0 + H;
      } else if (it.k === 'repo') {
        // 세로 고리 포털(토러스 윤곽) + 둘레 커밋 눈금. push 때 회전·흡입
        const r = C * 0.55 + 0.3, yc = Y0 + r + 0.15, c = col, ph = spin * 3;
        geo.vring(x, yc, z, r, c, la, 24); geo.vring(x, yc, z, r * 0.72, c, la * 0.7, 20);
        const ticks = Math.min(16, Math.max(4, (it.cnt?.push || 0) * 2 + (it.cnt?.write || 0)));
        for (let q = 0; q < ticks; q++) { const t = ph + (q / ticks) * Math.PI * 2; geo.line(x + Math.cos(t) * r, yc + Math.sin(t) * r, z, x + Math.cos(t) * r * 1.18, yc + Math.sin(t) * r * 1.18, z, c, la * 0.75); }
        geo.line(x - r * 0.6, Y0 + 0.02, z, x + r * 0.6, Y0 + 0.02, z, c, la * 0.6);
        if (R) { R.y = yc; R.top = yc + r; }
      } else if (it.k === 'remote') {
        // 섬 가장자리 접시 안테나(부두) + 섬 밖으로 뻗는 점선 끈(파선, 멀리 사라짐)
        const dl = Math.hypot(p.x, p.z) || 1, ux = p.x / dl, uz = p.z / dl, c = col;
        const r = C * 0.45, ys = Y0 + 0.9;
        geo.line(x, Y0, z, x, ys, z, c, la * 0.8);
        for (let q = -3; q <= 3; q++) { const t0 = (q / 3) * 0.9, t1 = ((q + 1) / 3) * 0.9; if (q === 3) break;
          geo.line(x + ux * (Math.cos(t0) * r * 0.5) - uz * Math.sin(t0) * r, ys + (1 - Math.cos(t0)) * r * 0.6, z + uz * (Math.cos(t0) * r * 0.5) + ux * Math.sin(t0) * r,
            x + ux * (Math.cos(t1) * r * 0.5) - uz * Math.sin(t1) * r, ys + (1 - Math.cos(t1)) * r * 0.6, z + uz * (Math.cos(t1) * r * 0.5) + ux * Math.sin(t1) * r, c, la); }
        for (let q = 0; q < 6; q++) { const d0 = 0.6 + q * 0.9, d1 = d0 + 0.45; geo.line(x + ux * d0, ys, z + uz * d0, x + ux * d1, ys, z + uz * d1, c, la * (1 - q / 6) * 0.8); }
        if (R) { R.y = ys; R.top = ys + 0.3; R.ox = ux; R.oz = uz; }
      } else if (it.k === 'service') {
        // 섬 위 가장자리에 떠 있는 작은 와이어 구(경선·위선, 점선) + 이니셜. 호출 때 맥동
        const r = (C * 0.4 + 0.2) * (1 + 0.25 * pulse), yc = Y0 + 2.6, c = col;
        geo.ring(x, yc, z, r, c, la, 16, true); geo.vring(x, yc, z, r, c, la * 0.8, 16, true); geo.vring(x, yc, z, r, c, la * 0.6, 16, true, 0, 0.35);
        geo.line(x, Y0, z, x, yc - r, z, c, la * 0.35);
        if ((px > 12 || lit > 0.05 || sel) && labelBudget > 0) { geo.label(x, yc + r + 0.15, z, String(it.n || '?').slice(0, 1).toUpperCase(), 'art-glyph', 'service', Math.max(0.5, la)); labelBudget--; }
        if (R) { R.y = yc; R.top = yc + r; }
      }
      // 중요 표식: 작은 방패 아이콘(선)
      if (it.imp) {
        const yy = Y0 + (it.k === 'db' ? 2.2 : it.k === 'service' ? 3.4 : it.k === 'output' ? 2.3 : blockHeight(it) + 0.45), s = 0.24, c = KI.imp, A = Math.min(1, la + 0.1);
        geo.line(x - s, yy + s, z, x + s, yy + s, z, c, A); geo.line(x + s, yy + s, z, x + s, yy - s * 0.2, z, c, A); geo.line(x - s, yy + s, z, x - s, yy - s * 0.2, z, c, A);
        geo.line(x - s, yy - s * 0.2, z, x, yy - s * 1.2, z, c, A); geo.line(x + s, yy - s * 0.2, z, x, yy - s * 1.2, z, c, A);
      }
      if (it.x && it.x !== 'overwrite' && nowMs - (it.xAt || 0) < ART.ALARM_MS) geo.rect(x - C * 0.5, Y0 + 0.02, z - C * 0.5, x + C * 0.5, z + C * 0.5, KI.alarm, 0.45 + 0.4 * lit);
      if ((sel || lit > 0.3) && labelBudget > 0) { geo.label(x, Y0 + (it.k === 'service' ? 3.9 : 2.2), z, it.n || it.id, 'art-item', it.k, sel ? 1 : Math.min(1, lit + 0.2)); labelBudget--; }
      // 에이전트 → 대상 빔: 점등 중이거나 초점(발자국·호버) 노드 것만, 늘 바닥층보다 밝게. 굵기 = 누적 수
      if (lit > 0.05 || foot) for (const w of it.who) {
        if (foot ? w.node !== env.foot.node : nowMs - w.last > ART.EDGE_RECENT_MS) continue;
        const np = env.nodePos(w.node); if (!np) continue;
        const ea = Math.max(LINE_A + 0.12, (foot ? 0.5 : 0.65 * lit)) * (w.v === 'read' ? 0.6 : 1);
        geo.line(np.x, np.y, np.z, x, Y0 + 0.4, z, w.v === 'read' ? KI.read : KI.write, ea, edgeWeight(w.c));
      }
      // 연출
      if (fxs) for (const e of fxs) {
        const k = Math.max(0, (nowSec - e.t0) / e.dur);
        if (k >= 1) continue;
        const ty = Y0 + 0.5;
        if (fx.acts && (e.kind === 'packet' || e.kind === 'read' || e.kind === 'rise' || e.kind === 'pulse')) continue; // 연출이 대신함
        if (e.kind === 'packet' || e.kind === 'read') {
          const np = e.node ? env.nodePos(e.node) : null;
          if (!np) continue;
          if (e.kind === 'read') { geo.line(np.x, np.y, np.z, x, ty, z, KI.read, 0.5 * (1 - k)); continue; }
          geo.line(np.x, np.y, np.z, x, ty, z, KI.write, 0.55 * (1 - k * 0.6));
          const n = e.amp || 2;
          for (let q = 0; q < n; q++) {
            const u = ease(Math.min(1, Math.max(0, k * 1.3 - q * 0.15)));
            if (u <= 0 || u >= 1) continue;
            geo.dot(np.x + (x - np.x) * u, np.y + (ty - np.y) * u, np.z + (z - np.z) * u, 0.38, e.v === 'query' ? KI.read : KI.write, 0.95);
          }
        } else if (e.kind === 'rise') {
          geo.rect(x - C * (0.4 + k), Y0 + 0.02, z - C * (0.4 + k), x + C * (0.4 + k), z + C * (0.4 + k), KI.new, 0.6 * (1 - k));
        } else if (e.kind === 'pulse') {
          const r = C * (0.45 + 0.8 * k * (0.5 + (e.amp || 0.3)));
          geo.rect(x - r, Y0 + 0.02, z - r, x + r, z + r, KI.write, 0.45 * (1 - k));
        } else if (e.kind === 'alarm' || e.kind === 'warn') {
          const rings = e.kind === 'alarm' ? 3 : 1;
          for (let q = 0; q < rings; q++) {
            const kk = k * 1.25 - q * 0.18;
            if (kk <= 0 || kk >= 1) continue;
            geo.ring(x, Y0 + 0.05, z, 0.5 + kk * (e.kind === 'alarm' ? 6 : 3) * Math.max(0.5, sk), e.kind === 'alarm' ? KI.alarm : KI.warn, 0.9 * (1 - kk), 28);
          }
          if (e.kind === 'alarm' && geo.labels.length < ARTGEO.LABELS) geo.label(x, Y0 + 2.6, z, '⚠ ' + artXLabel(e.x), 'art-alarm', 'alarm', 1 - k * 0.5);
        } else if (e.kind === 'absorb') {
          const n = e.amp || 3;
          const r = C * 0.55 + 0.3, yc = Y0 + r + 0.15;
          let q = 0;
          for (const [fid, fp] of L.pos) {
            if (q >= n) break;
            const fi = book.get(pid, fid);
            if (!fi || fi.k !== 'file' || fi.del) continue;
            const u = ease(Math.min(1, Math.max(0, k * 1.4 - q * 0.08)));
            if (u <= 0 || u >= 1) { q++; continue; }
            const sx = ax + fp.x * sk, sz2 = az + fp.z * sk;
            geo.dot(sx + (x - sx) * u, Y0 + 0.3 + (yc - Y0 - 0.3) * u + Math.sin(u * Math.PI) * 0.8, sz2 + (z - sz2) * u, 0.3, KI.repo, 0.9);
            q++;
          }
        }
      }
    }
  }
  geo.ka = 1;
  if (AC) drawActs(geo, AC, nowSec, { theme: 'flow', unitPx: env.cellPx ? (p) => { const a = env.anchor(p); return env.cellPx(p) / (ART.CELL * ((a && a.k) || 1)); } : null, KI, pos: AP, zoneOf: zoneKeyOf, book, nodePos: env.nodePos, reduced: env.reduced, isLight: env.isLight, pidAlpha: env.pidAlpha || null }); // 장면도 프로젝트 페이드
  return geo;
}
/** 구역 묶음 배치에서 대상이 묶인 구역 묶음 열쇠 */
export const zoneKeyOf = (it) => '#zone:' + districtKey(it);

/** 바닥층 세계 좌표 경계(카메라 맞춤): 프로젝트마다 네 모서리 점 [{p:{x,y,z}, r}] 을 out 에 더한다 */
export function artFitPoints(lay, anchor, out, { y = ART.FLOOR_Y, pid = null } = {}) {
  for (const [p, L] of lay) {
    if (pid && p !== pid) continue;
    const a = anchor(p);
    if (!a || !L.bounds) continue;
    const B = L.bounds, k = a.k || 1;
    for (const [bx, bz] of [[B.x0, B.z0], [B.x1, B.z0], [B.x0, B.z1], [B.x1, B.z1]]) out.push({ p: { x: a.x + bx * k, y, z: a.z + bz * k }, r: 1.2 });
  }
  return out;
}

/** 대상 집기(2D·3D 공통): 세계 (x,z)(바닥 높이) 가 가장 가까운 대상 {pid,id} (반경 = 칸 × 축척 × 0.75 안), 집계 묶음은 제외 */
export function artPickXZ(lay, anchor, wx, wz, maxK = 0.75) {
  let best = null, bd = Infinity;
  for (const [pid, L] of lay) {
    const a = anchor(pid); if (!a) continue;
    const k = a.k || 1, lim = ART.CELL * k * maxK;
    for (const [id, p] of L.pos) {
      if (id.startsWith('#zone:')) continue;
      const d = Math.hypot(a.x + p.x * k - wx, a.z + p.z * k - wz);
      if (d < lim && d < bd) { bd = d; best = { pid, id }; }
    }
  }
  return best;
}

// ───────────── 표현 공용 상태(흐름 3D·2D, 다음 단계 Planet·복셀도 그대로) ─────────────
/**
 * 집계(폴더 LOD) 항목: 파일·산출물을 구역(윗 폴더)마다 하나로 묶는다. 그 밖 종류(DB·저장소·원격·서비스)는 그대로.
 * 묶음 항목 {id:'#zone:<구역>', k:'zone', n:구역 이름, d, first, last, count, cnt, imp}
 */
export function aggregateItems(items) {
  const out = [], zm = new Map();
  for (const it of items) {
    if (it.k !== 'file' && it.k !== 'output') { out.push(it); continue; }
    const dk = districtKey(it);
    let z = zm.get(dk);
    if (!z) { z = { id: '#zone:' + dk, k: 'zone', n: topFolder(it.d ?? dirOf(it.p || it.id)) || t('boards.district.root'), d: it.d, first: it.first, last: it.last, count: 0, cnt: { modify: 0 }, imp: null, who: [], log: [] }; zm.set(dk, z); out.push(z); }
    z.count++; z.cnt.modify += editsOf(it); z.first = Math.min(z.first, it.first); z.last = Math.max(z.last, it.last);
    if (it.imp && !z.imp) z.imp = it.imp;
  }
  return out;
}

/**
 * 한 표현(view)이 갖는 작업 대상 층 상태: 앱이 준 장부·연출 큐 + 이 표현의 배치·섬 중심·발자국·선택.
 * 섬 안 보장: 축척 k = 바닥층 경계가 섬 슈퍼타원 안(지수 3·여유 0.86)에 들도록. k 가 ART.LOD_SCALE 보다 작아야 하면
 * 폴더 묶음(집계) 배치로 바꾸고 다시 맞춘다(섬을 키우지 않음). 섬 중심은 바로 따라감(섬이 움직이면 같이), k 는 줄 때 바로·늘 때 부드럽게.
 */
export class ArtState {
  constructor({ book, fx, style = null }) {
    this.book = book; this.fx = fx;
    this.style = style || { ...ART_STYLE_DEFAULT };
    this.layout = new ArtLayout();      // 대상별 배치
    this.aggLayout = new ArtLayout();   // 폴더 묶음 배치
    this.lay = new Map();      // pid → 배치(집계면 .agg = Map<id, 묶음 항목>)
    this.full = new Map();     // pid → 대상별 배치(캐시)
    this.anchors = new Map();  // pid → {x, z, k}
    this.boxes = new Map();    // pid → {hw, hd}
    this._ver = -1; this._pkey = ''; this._at = 0;
    this.foot = null; this.sel = null;
    this.geo = new ArtGeo();
  }
  /** 보이는 프로젝트 배치를 맞춘다(장부·프로젝트 집합·섬 크기가 바뀌었을 때, 0.25초에 한 번까지). 바뀌었으면 true */
  syncLayout(pids, nowSec, targetOf = null) {
    const bkey = targetOf ? pids.map((p) => { const t = targetOf(p); return t ? `${Math.round(t.hw)}x${Math.round(t.hd)}` : '-'; }).join(',') : '';
    const key = pids.join('|') + '#' + bkey;
    if (this.book.version === this._ver && key === this._pkey) return false;
    if (nowSec - this._at < 0.25 && this.book.version !== this._ver && key === this._pkey) return false;
    this._at = nowSec; this._ver = this.book.version; this._pkey = key;
    const keep = new Set(pids);
    for (const p of [...this.lay.keys()]) if (!keep.has(p)) { this.lay.delete(p); this.full.delete(p); this.anchors.delete(p); }
    for (const p of pids) {
      const items = this.book.shownItems(p);
      const full = this.layout.sync(p, items);
      this.full.set(p, full);
      const t = targetOf ? targetOf(p) : null;
      if (t) this.boxes.set(p, { hw: t.hw, hd: t.hd });
      let L = full;
      if (t && fitScale(full.bounds, t) < ART.LOD_SCALE) { // 폴더 LOD: 묶어서 다시
        const ag = aggregateItems(items);
        L = this.aggLayout.sync(p, ag);
        L.agg = new Map(ag.filter((x) => x.k === 'zone').map((x) => [x.id, x]));
      }
      this.lay.set(p, L);
    }
    if (this.foot) this.foot.set = this.book.touchedBy(this.foot.pid, this.foot.node);
    return true;
  }
  /** 섬 중심(바로)·축척(줄 때 바로, 늘 때 부드럽게) */
  anchorStep(pid, target, dt) {
    if (!target) return null;
    if (target.hw > 0) this.boxes.set(pid, { hw: target.hw, hd: target.hd });
    const kt = this.scaleFor(pid, target);
    let a = this.anchors.get(pid);
    if (!a) { a = { x: target.x, z: target.z, k: kt }; this.anchors.set(pid, a); return a; }
    a.x = target.x; a.z = target.z;
    if (kt <= a.k) a.k = kt;
    else { a.k += (kt - a.k) * (1 - Math.exp(-Math.max(0, dt) * 4)); if (kt - a.k < 0.002) a.k = kt; }
    return a;
  }
  /** 바닥층 축척(섬 슈퍼타원 안) — 하한 없음(묶음 배치로 이미 줄였으므로 마지막 보장) */
  scaleFor(pid, target) {
    const L = this.lay.get(pid);
    if (!L || !L.bounds || !target || !(target.hw > 0) || !(target.hd > 0)) return 1;
    return fitScale(L.bounds, target);
  }
  anchor(pid) { return this.anchors.get(pid) || null; }
  setFoot(pid, nodeId) { this.foot = nodeId ? { pid, node: nodeId, set: this.book.touchedBy(pid, nodeId) } : null; }
  /** 초점(발자국 > 호버·선택 노드): 그 노드가 만진 대상 집합 — 노드·장부가 바뀔 때만 다시 */
  focusFor(nodeId, pidOf) {
    if (this.foot) return this.foot;
    if (!nodeId) return null;
    const pid = pidOf(nodeId);
    if (!pid || !this.lay.has(pid)) return null;
    const key = nodeId + '|' + this.book.version;
    if (this._fk !== key) { this._fk = key; const set = this.book.touchedBy(pid, nodeId); this._focus = set.size ? { pid, node: nodeId, set } : null; }
    return this._focus;
  }
  /**
   * 한 프레임 준비(표현 공용): 연출 시계·배치·섬 중심. 반환 = 섬 중심이 움직였나.
   * targetOf(pid) → {x, z, hw, hd}(전체 보기 = 섬 상자, 단일 세션 = 노드 경계)
   */
  frame(pids, targetOf, nowSec, dt) {
    this.fx.step(nowSec);
    this.syncLayout(pids, nowSec, targetOf);
    let moved = false;
    for (const p of pids) {
      const a0 = this.anchors.get(p); const bx = a0 ? a0.x : NaN, bz = a0 ? a0.z : NaN, bk = a0 ? a0.k : NaN;
      const a = this.anchorStep(p, targetOf(p), dt);
      if (a && (a.x !== bx || a.z !== bz || a.k !== bk)) moved = true;
    }
    return moved;
  }
  /** 대상 하나의 세계 좌표(묶음 배치면 그 구역 묶음 자리) */
  worldOf(pid, id, y = ART.FLOOR_Y) {
    const L = this.lay.get(pid), a = this.anchors.get(pid);
    if (!L || !a) return null;
    let p = L.pos.get(id);
    if (!p && L.agg) { const it = this.book.get(pid, id); if (it) p = L.pos.get('#zone:' + districtKey(it)); }
    if (!p) return null;
    const k = a.k || 1;
    return { x: a.x + p.x * k, y: y + 0.6, z: a.z + p.z * k };
  }
}
/** 경계 상자(섬 로컬, 원점 = 섬 중심) 네 모서리가 섬 슈퍼타원 안에 들도록 하는 축척(≤1) */
export function fitScale(B, t) {
  if (!B || !t || !(t.hw > 0) || !(t.hd > 0)) return 1;
  let k = 1;
  for (const [x, z] of [[B.x0, B.z0], [B.x1, B.z0], [B.x0, B.z1], [B.x1, B.z1]]) {
    const s = Math.pow(Math.abs(x) / (t.hw * 0.86), 3) + Math.pow(Math.abs(z) / (t.hd * 0.86), 3);
    if (s > 0) k = Math.min(k, Math.pow(1 / s, 1 / 3));
  }
  return Math.max(0.02, k);
}

// ───────────── 바닥 글씨(프로젝트 이름 발자국) ─────────────
/** 프로젝트 이름 → 바닥 글씨 줄(1～2): 경로면 마지막 이름(너무 짧으면 끝 두 조각), 길면(>12자) 구분자에서 두 줄 */
export function artNameLines(name) {
  let n = String(name || '').trim().replace(/^\((?:임시|temp)\)\s*/, '');
  const segs = n.split(/[\\/]/).filter(Boolean);
  if (segs.length > 1) n = segs[segs.length - 1].length <= 4 ? segs.slice(-2).join('/') : segs[segs.length - 1];
  n = n.slice(0, 28);
  if (n.length <= 14) return n ? [n] : [];
  const mid = n.length / 2;
  let best = -1, bd = 1e9;
  for (let i = 1; i < n.length - 1; i++) if (/[\s_./-]/.test(n[i]) && Math.abs(i - mid) < bd) { bd = Math.abs(i - mid); best = i; }
  if (best < 0) return [n];
  return [n.slice(0, best + (n[best] === ' ' ? 0 : 1)).trim(), n.slice(best + 1).trim()].filter(Boolean);
}
/**
 * 바닥 글씨 판 크기: 섬 폭의 0.78(70～85%)을 기본으로, 높이가 섬 깊이의 0.55 를 넘거나 슈퍼타원 모서리 밖이면 줄인 뒤
 * NAME_PLATE_SCALE(0.5 — 너무 크다는 피드백으로 절반)을 곱함.
 * aspect = 글씨 판 높이/너비(캔버스에서 잰 값). 반환 {w, h}(세계 단위)
 */
const NAME_PLATE_SCALE = 0.5;
export function artNamePlate(t, aspect) {
  if (!t || !(t.hw > 0) || !(t.hd > 0)) return null;
  let w = t.hw * 2 * 0.78, h = w * aspect;
  if (h > t.hd * 2 * 0.55) { h = t.hd * 2 * 0.55; w = h / aspect; }
  for (let i = 0; i < 20 && !inIsland(w / 2, h / 2, t.hw, t.hd, 0.95); i++) { w *= 0.94; h *= 0.94; }
  return { w: w * NAME_PLATE_SCALE, h: h * NAME_PLATE_SCALE };
}
/** 글씨가 충분히 읽히면(한 줄 높이 ≥ ART.NAME_READ_PX 화면 px) 떠 있는 섬 이름 라벨은 흐리게 */
export const artNameReadable = (linePx) => linePx >= ART.NAME_READ_PX;
/**
 * 바닥 글씨 방향(y축 회전, 라디안): 섬 중심 → 카메라 방향(dx, dz)에 가장 가까운 90° 단위 — 늘 바로 읽힘.
 * 0 = +x 로 읽고 글자 위쪽이 −z(카메라가 +z 쪽). prev 가 있으면 경계 근처(±10°)에선 그대로(흔들림 방지).
 */
export function artNameYaw(dx, dz, prev = null) {
  const a = Math.atan2(dx, dz), Q = Math.PI / 2;
  if (prev != null) { let d = a - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < Q / 2 + (10 * Math.PI) / 180) return prev; }
  return Math.round(a / Q) * Q;
}
/** 각도 보간(최단 방향, 약 0.6초에 거의 다 — 지수), 움직임 줄이기면 바로 */
export function artAngleStep(cur, target, dt, reduced = false) {
  if (reduced || cur == null) return target;
  let d = target - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
  const k = 1 - Math.exp(-Math.max(0, dt) * 7);
  const nx = cur + d * k;
  return Math.abs(target - nx) < 0.002 ? target : nx;
}
/** 회전에 맞춘 판 크기: 90°·270° 면 섬 반폭·반깊이를 바꿔 맞춤 */
export function artNamePlateYaw(t, aspect, yaw) {
  const q = Math.round(yaw / (Math.PI / 2)) & 1;
  return artNamePlate(q ? { ...t, hw: t.hd, hd: t.hw } : t, aspect);
}

// ───────────── 상세 팝업 모델 ─────────────
const ago = (ms) => (ms < 60_000 ? t('boards.ago.now') : ms < 3_600_000 ? t('boards.ago.m', { n: Math.round(ms / 60_000) }) : ms < 86_400_000 ? t('boards.ago.h', { n: Math.round(ms / 3_600_000) }) : t('boards.ago.d', { n: Math.round(ms / 86_400_000) }));
/**
 * 대상 하나의 팝업 내용 모델: 머리·요약·누가 언제 무엇을(최근 기록)·관계 노드.
 * labelOf(nodeId) → 이름(화면 노드 라벨 또는 book.nodeLabels)
 */
export function artInspectModel(it, nowMs, labelOf = (id) => id) {
  if (!it) return null;
  const c = it.cnt || {};
  const verbs = ART_VERBS.filter((v) => c[v]).map((v) => `${ART_VERB_LABEL[v]} ${c[v]}`);
  const lines = [];
  if (it.sz) lines.push(t('boards.insp.size', { n: fmtNum(it.sz) }));
  if (it.rows != null) lines.push(t('boards.insp.rows', { n: fmtNum(Number(it.rows)) }));
  if (it.coll && it.coll.length) lines.push(t('boards.insp.coll', { list: it.coll.join(', ') }));
  const log = [...(it.log || [])].sort((a, b) => b.t - a.t).map((l) => ({
    when: ago(nowMs - l.t), at: l.t, who: l.node ? labelOf(l.node) : '?', node: l.node, verb: ART_VERB_LABEL[l.v] || l.v,
    detail: [l.sz ? t('boards.insp.lines', { n: l.sz }) : '', l.rows != null ? t('boards.insp.rowsN', { n: l.rows }) : '', l.c ? t('boards.insp.commits', { n: l.c }) : '', l.x ? ART_X_LABEL[l.x] : ''].filter(Boolean).join(' · '),
    x: !!l.x && l.x !== 'overwrite',
  }));
  return {
    glyph: ART_GLYPH[it.k] || '▤', kind: ART_KIND_LABEL[it.k] || it.k, title: it.n || it.id, path: it.p || (it.k === 'file' || it.k === 'output' ? it.id : null),
    state: it.del ? t('boards.state.deleted') : it.x && it.x !== 'overwrite' && nowMs - (it.xAt || 0) < ART.ALARM_MS ? t('boards.state.afterX') : t('boards.state.present'),
    last: ago(nowMs - (it.last || 0)), first: ago(nowMs - (it.first || 0)), verbs: verbs.join(' · '), lines,
    imp: it.imp ? ART_IMP_LABEL[it.imp] : null, x: it.x ? ART_X_LABEL[it.x] : null, est: !!it.est,
    who: [...(it.who || [])].sort((a, b) => b.last - a.last).map((w) => ({ node: w.node, name: labelOf(w.node), c: w.c, verb: ART_VERB_LABEL[w.v] || w.v, when: ago(nowMs - w.last) })),
    log,
  };
}

/** 실황 패널 고정 줄(파괴적 작업) 문구 */
export function artAlarmText(ref, who = '') {
  return `⚠ ${artXLabel(ref.x)} · ${ref.n || ref.id}${who ? ` · ${who}` : ''}`;
}

// ───────────── 데모·mock 표본 ─────────────
/**
 * 데모 프로젝트의 '지난 며칠' 대상(바램 확인용, 결정적): 폴더 몇 개에 파일 + DB·저장소·원격·서비스.
 * 반환 [{t, node, tu, art}] — 서버 MemoryArtifactSource.seed·웹 mock 기본 장부가 쓴다.
 */
export function artHistorySample(projectId, nowMs = Date.now(), { mainNode = 's:demo', n = 36 } = {}) {
  const H = 3_600_000;
  const folders = ['src', 'src/flow', 'web', 'web/flat', 'docs', 'test', 'server', 'scripts'];
  const out = [];
  let seed = 0; for (const ch of projectId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    const d = folders[Math.floor(rnd() * folders.length)];
    const f = `${d}/${['index', 'core', 'view', 'util', 'state', 'model', 'draw', 'notes'][Math.floor(rnd() * 8)]}${i}.${d.startsWith('docs') ? 'md' : 'mjs'}`;
    const age = (0.5 + rnd() * 160) * H; // 30분 ～ 6.7일 전
    const t = Math.round(nowMs - age);
    const v = rnd() < 0.3 ? 'create' : 'modify';
    out.push({ t, node: mainNode, tu: `hist-${projectId}-${i}`, art: [{ k: 'file', id: f.toLowerCase(), p: f, d, n: f.split('/').pop(), v, sz: 1 + Math.floor(rnd() * 80) }] });
    if (rnd() < 0.35) out.push({ t: t + 60_000, node: mainNode, tu: `hist-${projectId}-${i}b`, art: [{ k: 'file', id: f.toLowerCase(), p: f, d, n: f.split('/').pop(), v: 'modify', sz: 3 }] });
  }
  out.push({ t: nowMs - 30 * H, node: mainNode, tu: `hist-${projectId}-db`, art: [{ k: 'db', id: 'db:mongo/demo', n: 'demo', v: 'write', coll: ['cases', 'logs'], imp: 'db', rows: 4821 }] });
  out.push({ t: nowMs - 26 * H, node: mainNode, tu: `hist-${projectId}-repo`, art: [{ k: 'repo', id: 'repo:viz', n: 'viz', v: 'push', c: 4 }] });
  out.push({ t: nowMs - 50 * H, node: mainNode, tu: `hist-${projectId}-rm`, art: [{ k: 'remote', id: 'remote:demo-server', n: 'demo-server', v: 'query' }] });
  out.push({ t: nowMs - 100 * H, node: mainNode, tu: `hist-${projectId}-out`, art: [{ k: 'output', id: 'out/초안.docx', p: 'out/초안.docx', d: 'out', n: '초안.docx', v: 'create' }] });
  out.push({ t: nowMs - 5 * H, node: mainNode, tu: `hist-${projectId}-del`, art: [{ k: 'file', id: 'src/old/tmp.js', p: 'src/old/tmp.js', d: 'src/old', n: 'tmp.js', v: 'delete' }] });
  return out.sort((a, b) => a.t - b.t);
}

// ───────────── 토글 저장(⚙ 메뉴 '작업 대상 층') ─────────────
export const ART_VIEWS_READY = new Set(['flow', 'planet', 'voxel']); // 흐름 · Planet·복셀
export const artStoreKey = (view) => `ccviz.artifacts.${view}`;
/** 켬/끔: URL ?artifacts=1|0 이 이번 접속에서 우선, 아니면 표현별 저장값, 기본 끔. 준비 안 된 표현은 늘 끔 */
export function artInitial(view, urlVal, stored) {
  if (!ART_VIEWS_READY.has(view)) return false;
  if (urlVal === '1' || urlVal === 'true') return true;
  if (urlVal === '0' || urlVal === 'false') return false;
  return stored === '1';
}
