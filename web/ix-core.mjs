// 특별 상호작용 연출 — 순수 부분. 서버가 이벤트에 실어 보낸 ix(범주·세부)를
//  ① 글리프·색·요약 한 줄(실황 패널·하단 타임라인), ② 효과 장부(IxModel: 시작·진행·끝·잔광·상한),
//  ③ 그릴 도형 목록(ixGeometry: 세계 좌표의 선·작은 사각·라벨)으로 바꾼다.
// 3D(web/ix-fx.js, three)와 2D(web/flat/ix2d.js, canvas)는 ③을 그대로 그리기만 한다 — 그래서 두 차원·두 표현이 같은 의미를 보인다.
// 복셀은 아직 그리지 않는다(개편 때 같은 IxModel 을 받아 은유만 바꿈).

import { t as tr, fmtNum } from './i18n.mjs';

export const IX_CATS = ['github', 'db', 'remote', 'batch', 'tests', 'user'];

let cssDone = false;
/** 라벨·패널 글리프 스타일(ix.css) 한 번 불러오기 — 브라우저에서만 */
export function ensureIxCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const href = new URL('./ix.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}
export const IX_GLYPH = { github: '⎇', db: '⛁', remote: '⇄', batch: '▦', tests: '✔', user: '◉' };
export const IX_LABEL = { github: 'GitHub', db: 'DB', remote: tr('cards.ix.cat.remote'), batch: tr('cards.ix.cat.batch'), tests: tr('cards.ix.cat.tests'), user: tr('cards.ix.cat.user') };
export const IX_HUE = { github: 268, db: 190, remote: 318, batch: 38, tests: 145, user: 46 };
/** 범주 색(CSS). 라이트는 진하게 */
export function ixColor(cat, isLight = false) {
  const h = IX_HUE[cat] ?? 225;
  return isLight ? `hsl(${h}, 70%, 38%)` : `hsl(${h}, 85%, 66%)`;
}
/** 도형 색 열쇠 → 색(테마). 렌더러가 한 번 풀어 둔다 */
export const IX_KEYS = ['github', 'db', 'remote', 'batch', 'tests', 'ok', 'err', 'skip', 'read', 'write', 'dim', 'warn', 'user', 'auto', 'sched', 'mon'];
export function ixKeyColor(key, isLight = false) {
  switch (key) {
    case 'ok': return isLight ? '#15803d' : '#4ade80';
    case 'err': return isLight ? '#dc2626' : '#f87171';
    case 'skip': case 'dim': return isLight ? '#94a3b8' : '#64748b';
    case 'read': return isLight ? '#0369a1' : '#7dd3fc';   // 차가운 색(읽기)
    case 'write': return isLight ? '#c2410c' : '#fdba74';  // 따뜻한 색(쓰기)
    case 'warn': return isLight ? '#b45309' : '#fbbf24';
    case 'user': return isLight ? '#a16207' : '#fcd34d';   // 금빛(사용자)
    case 'auto': return isLight ? '#9ca3af' : '#6b7280';   // 자동 알림 회색
    case 'sched': return isLight ? '#0e7490' : '#67e8f9';  // 예약 작업(시계)
    case 'mon': return isLight ? '#7c3aed' : '#c4b5fd';    // Monitor 출력
    default: return ixColor(key, isLight);
  }
}

const n0 = (x) => (Number.isFinite(x) ? x : 0);
const fmtN = (x) => fmtNum(Number(x || 0));
function fmtBytes(b) {
  if (!Number.isFinite(b) || b <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
}
const fmtMs = (ms) => (!Number.isFinite(ms) || ms <= 0 ? '' : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : tr('cards.t.m', { n: Math.round(ms / 60000) }));

/** 시험 점수 문구 `✓ 238 ✗ 1 ⊘ 3` */
export function testScore(ix) {
  const p = [`✓${fmtN(ix.pass)}`];
  if (n0(ix.fail)) p.push(`✗${fmtN(ix.fail)}`);
  if (n0(ix.skip)) p.push(`⊘${fmtN(ix.skip)}`);
  return p.join(' ');
}

/** 요약 한 줄(실황 패널·타임라인 풍선): `push 3 commits → origin/main`, `pytest ✓120 ✗2` */
export function ixSummary(ix) {
  if (!ix || !ix.cat) return '';
  const done = ix.phase === 'end';
  const fail = ix.ok === false;
  switch (ix.cat) {
    case 'github': {
      const ref = [ix.remote, ix.branch].filter(Boolean).join('/');
      switch (ix.op) {
        case 'push': {
          if (!done) return `push${ref ? ' → ' + ref : ''}${ix.commitsHere ? ` (${tr('cards.ix.commitsHere', { n: ix.commitsHere })})` : ''}`;
          if (ix.rejected || fail) return `push ${tr('cards.ix.rejected')}${ref ? ' · ' + ref : ''}`;
          if (ix.upToDate) return `push · ${tr('cards.ix.upToDate')}`;
          const c = n0(ix.commits) || 1;
          return `push ${c} commit${c === 1 ? '' : 's'} → ${ref || ix.repo || 'origin'}${ix.newBranch ? ` (${tr('cards.ix.newBranch')})` : ''}`;
        }
        case 'pull': case 'fetch':
          return `${ix.op}${ref ? ' ' + ref : ''}${done ? (ix.upToDate ? ` · ${tr('cards.ix.upToDate')}` : ix.files ? ` · ${ix.files} files` : ix.refs ? ` · ref ${ix.refs}` : '') : ''}${ix.conflicts ? ` · ${tr('cards.ix.conflicts', { n: ix.conflicts })}` : ''}`;
        case 'clone': return `clone ${ix.repo || ''}${ix.n ? ` ${Math.round((ix.i / ix.n) * 100)}%` : ''}`.trim();
        case 'commit': return `commit${ix.branch ? ' ' + ix.branch : ''}${ix.files ? ` · ${ix.files} files` : ''}${ix.empty ? ` · ${tr('cards.ix.noChange')}` : ''}`;
        case 'merge': case 'rebase': return `${ix.op}${ix.branch ? ' ' + ix.branch : ''}${ix.conflicts ? ` · ${tr('cards.ix.conflicts', { n: ix.conflicts })}` : ''}`;
        case 'tag': return `tag ${ix.tag || ''}`.trim();
        case 'pr-create': return ix.pr ? tr('cards.ix.prCreated', { pr: ix.pr }) : tr('cards.ix.prCreate');
        case 'pr-merge': return ix.pr ? tr('cards.ix.prMerged', { pr: ix.pr }) : tr('cards.ix.prMerge');
        case 'pr-checks': case 'run': {
          const head = ix.op === 'run' ? tr('cards.ix.ciRun') : `CI${ix.pr ? ' #' + ix.pr : ''}`;
          if (!ix.ci) return head + (done ? '' : ' ' + tr('cards.ix.pending'));
          return `${head} ✓${ix.ci.pass || 0}${ix.ci.fail ? ' ✗' + ix.ci.fail : ''}${ix.ci.pending ? ' …' + ix.ci.pending : ''}`;
        }
        case 'pr-view': return ix.pr ? `PR #${ix.pr}` : tr('cards.ix.prView');
        case 'release': return 'release';
        case 'repo': return 'gh repo';
        default: return 'gh api';
      }
    }
    case 'tests': {
      const r = ix.runner || 'test';
      if (ix.pass == null && ix.fail == null) return `${r}${ix.pct != null ? ` ${ix.pct}%` : ' ' + tr('cards.ix.run')}`;
      return `${r} ${testScore(ix).replace(/ /g, ' ')}${ix.partial && !done ? ' …' : ''}${done && ix.ms ? ' · ' + fmtMs(ix.ms) : ''}`;
    }
    case 'db': {
      const rw = tr(ix.rw === 'w' ? 'cards.ix.write' : ix.rw === 'rw' ? 'cards.ix.rw' : 'cards.ix.read');
      return `${ix.engine || 'db'}${ix.db ? ' ' + ix.db : ''} ${rw}${ix.rows != null ? ` · ${tr('cards.ix.rows', { n: fmtN(ix.rows) })}` : ''}${ix.weak ? ` (${tr('cards.ix.est')})` : ''}`;
    }
    case 'remote': {
      const arrow = ix.transfer === 'up' ? ' ↑' : ix.transfer === 'down' ? ' ↓' : '';
      const sz = fmtBytes(ix.bytes || ix.size);
      return `${ix.op || 'ssh'}${arrow} ${ix.host || tr('cards.ix.remote')}${sz ? ' · ' + sz : ''}${fail && done ? ' · ' + tr('cards.ix.failed') : ''}`;
    }
    case 'user': {
      const w = Number.isFinite(ix.waitMs) && ix.waitMs > 60000 ? ` · ${tr('cards.ix.after', { t: fmtMs(ix.waitMs) })}` : '';
      const me = tr('cards.ix.me');
      switch (ix.op) {
        case 'prompt': return `${me} › ${ix.text || ''}${ix.images ? ` [${tr('cards.ix.images', { n: ix.images })}]` : ''}${w}`.trim();
        case 'midturn': return `${me} › ${tr('cards.ix.midturn')} ${ix.text || ''}`.trim();
        case 'command': return `${me} › ${ix.cmd || tr('cards.ix.cmd')}${ix.text ? ' ' + ix.text : ''}`;
        case 'interrupt': return `${me} › ${tr('cards.ix.interrupt')}`;
        case 'deny': return `${me} › ${tr('cards.ix.deny')} · ${ix.tool || tr('cards.ix.tool')}`;
        case 'ask': return done ? (ix.declined ? `${tr('cards.ix.q')} › ${tr('cards.ix.declined')}` : `${tr('cards.ix.a')} › ${ix.pick != null ? `${tr('cards.ix.pick', { n: ix.pick + 1 })} · ` : ''}${ix.answer || ''}`) : `${tr('cards.ix.q')} › ${ix.text || ''}${ix.opts ? ` (${tr('cards.ix.opts', { n: ix.opts })})` : ''}`;
        case 'reply': return `${tr('cards.ix.reply')}${ix.turnMs ? ' · ' + fmtMs(ix.turnMs) : ''}${ix.text ? ' · ' + ix.text : ''}`;
        case 'auto': return '';
        default: return '';
      }
    }
    case 'batch': {
      if (ix.op === 'fan') return tr('cards.ix.fan', { n: ix.i || 0 });
      if (ix.op === 'streak') return tr('cards.ix.streak', { tool: ix.tool || tr('cards.ix.tool'), n: ix.i || 0 });
      if (ix.op === 'workflow') return tr('cards.ix.workflow');
      const prog = ix.n ? `${ix.i ?? 0}/${ix.n}` : ix.pct != null ? `${ix.pct}%` : '';
      return `${ix.op === 'loop' ? tr('cards.ix.loop') : ix.op}${prog ? ' ' + prog : ix.n ? ` ${ix.n}` : ''}${ix.par ? ` ×${ix.par}` : ''}`;
    }
    default: return '';
  }
}

const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** 실황 패널 머리: 글리프 + 요약(색은 ix.css 의 .ix-c-<범주>, 실패는 .ix-fail) */
export function ixHtml(ix) {
  if (!ix || !IX_CATS.includes(ix.cat) || (ix.cat === 'user' && ix.op === 'auto')) return '';
  const fail = ix.phase === 'end' && ix.ok === false;
  const s = ixSummary(ix);
  return `<span class="ixg ix-c-${ix.cat}${fail ? ' ix-fail' : ''}" title="${escH(IX_LABEL[ix.cat])}">${IX_GLYPH[ix.cat]}</span>${s ? `<span class="ixs ix-c-${ix.cat}${fail ? ' ix-fail' : ''}">${escH(s)}</span> ` : ''}`;
}
/** 하단 타임라인 표식(없으면 null): 시작 = 위 줄 글리프, 끝 = 아래 줄 결과색 글리프. 진행 출력은 끝만 */
export function ixMark(ev) {
  const ix = ev && ev.ix;
  if (!ix || !IX_CATS.includes(ix.cat)) return null;
  const s = ixSummary(ix);
  if (ev.type === 'tool-start') return { shape: 'glyph', glyph: IX_GLYPH[ix.cat], color: 'ix:' + ix.cat, cat: ix.cat, label: `${IX_GLYPH[ix.cat]} ${s}` };
  if ((ev.type === 'tool-end' || ev.type === 'output') && ix.phase === 'end') return { shape: 'glyph', glyph: IX_GLYPH[ix.cat], color: ix.ok === false ? 'error' : 'ok', row: 1, label: `${IX_GLYPH[ix.cat]} ${s}` };
  return null;
}

// ───────────────────────── 효과 장부 ─────────────────────────
export const IXFX = {
  MAX: 48, PER_NODE: 3,
  // 잔광(초, ÷√배속). 하한 LINGER_MIN(F5) — 예전 remote 1.4·db 2.4·batch 2.0 은 끝나고 1～2초 뒤 이미 없었다
  LINGER: { github: 3.6, db: 3.5, remote: 3.0, batch: 3.0, tests: 5.0, user: 3.0 },
  LINGER_MIN: 3,
  USER_PER_NODE: 4,      // 사용자 효과는 따로 센다(다른 범주를 밀어내지 않게)
  CONSOLE_DIM_S: 900,    // 답변 뒤 이만큼 지나면 콘솔이 가장 어두워짐
  GATE_S: 1.2,           // 반복·병렬·진행은 이만큼 이어질 때만 보인다(짧은 for 는 조용히)
  GATE_N: 20,            // 이 이상 총량이면 곧바로
  IDLE_S: 6,             // 연속·분기는 새 호출이 없으면 끝
  TTL_S: 600, TTL_BG_S: 1800,
  PORTAL_S: 600,         // 최근 이만큼 github 활동이 있으면 포털이 아주 옅게 남음
  CI_AFTERGLOW: 6,
};
const isEnded = (s) => s === 'done' || s === 'error' || s === 'stopped';

/**
 * 사용자 아닌 것이 연 메인 턴(user · op auto)의 연출 종류: 'schedule'(예약 작업 — 시계·알람) · 'monitor'(Monitor 출력 → 메인 패킷)
 * · 'result'(작업 끝 알림 — 출처 노드 → 메인 결과 패킷, st ok·err·stop) · 'dot'(그 밖 — 예전 회색 작은 점)
 */
export function ixAutoKind(ix) {
  if (!ix || ix.cat !== 'user' || ix.op !== 'auto') return null;
  if (ix.src === 'schedule') return 'schedule';
  if (ix.src === 'monitor') return 'monitor';
  if (ix.src === 'notify' && ix.from && ix.st) return 'result';
  return 'dot';
}
/** 자동 턴 연출 시간(초, ÷√배속 전): 회색 점은 예전처럼 1초, 나머지는 사용자 효과와 같은 잔광 */
export const IX_AUTO = { DOT_S: 1, LINGER_S: 3.2, TRAVEL_S: 0.9, CLOCK_R: 0.6 };
const autoLinger = (ix) => (ixAutoKind(ix) === 'dot' ? IX_AUTO.DOT_S : IX_AUTO.LINGER_S);

/** 노드별 상호작용 효과. now = 초(렌더러 시계), speed = 재생 배속(잔광을 √배속으로 줄임) */
export class IxModel {
  constructor() { this.fx = new Map(); this.portal = new Map(); this.console = new Map(); this.seq = 0; this.dirtyAt = 0; }
  clear() { this.fx.clear(); this.portal.clear(); this.console.clear(); }
  get size() { return this.fx.size; }
  _key(ev) {
    const ix = ev.ix;
    if (ix.cat === 'batch' && (ix.op === 'streak' || ix.op === 'fan')) return `${ix.op}:${ev.nodeId}`;
    if (ev.type === 'output') return ix.ref || `out:${ev.nodeId}`;
    if (ix.cat === 'user' && ix.op !== 'ask') return `u:${this.seq + 1}`; // 사용자 메시지는 한 건씩
    return ev.toolUseId || `n:${ev.nodeId}:${ix.cat}`;
  }
  /** 이벤트 하나. 연출 변화가 있으면 true. rootOf(nodeId) → 뿌리 노드 id(포털 자리) */
  event(ev, now, speed = 1, rootOf = null) {
    if (!ev) return false;
    if (ev.type === 'node-add' && ev.node) {
      const tu = ev.node.meta && ev.node.meta.toolUseId;
      if (tu && this.fx.has(tu)) { this.fx.get(tu).bgNode = ev.node.id; return false; }
      return false;
    }
    if (ev.type === 'node-update' && ev.patch && isEnded(ev.patch.status)) {
      let hit = false;
      for (const f of this.fx.values()) if ((f.bgNode === ev.nodeId || (f.nodeId === ev.nodeId && !f.ix.bg)) && f.tEnd == null) { f.tEnd = now; if (f.ok == null) f.ok = ev.patch.status !== 'error'; f.ix = { ...f.ix, phase: 'end' }; hit = true; }
      return hit;
    }
    const ix = ev.ix;
    if (!ix || !IX_CATS.includes(ix.cat)) return false;
    const key = this._key(ev);
    let f = this.fx.get(key);
    const k = Math.max(1, Math.sqrt(speed || 1));
    if (!f) {
      if (ev.type === 'tool-end' && ix.phase !== 'end' && ix.phase !== 'progress') return false;
      const nodeId = ev.type === 'output' ? (ev.ix.ref ? null : ev.nodeId) : ev.nodeId;
      f = { key, nodeId: nodeId || ev.nodeId, cat: ix.cat, op: ix.op, ix: { ...ix }, t0: now, tEnd: null, ok: null, lastAt: now, seq: ++this.seq, hist: [], k, bgNode: ev.type === 'output' ? ev.nodeId : null, pulses: [] };
      const gated = ix.cat === 'batch' && !['streak', 'fan', 'workflow'].includes(ix.op) && !(ix.n >= IXFX.GATE_N);
      f.showAt = gated ? now + IXFX.GATE_S / k : now;
      this.fx.set(key, f);
      this._cap(f.nodeId);
    } else {
      f.ix = { ...f.ix, ...ix };
      f.lastAt = now;
      if (ix.op === 'fan' || ix.op === 'streak') { f.pulses.push(now); if (f.pulses.length > 8) f.pulses.shift(); f.tEnd = null; }
    }
    if (ix.i != null) { f.hist.push([now, ix.i]); if (f.hist.length > 16) f.hist.shift(); }
    if (ix.phase === 'end' && f.tEnd == null) {
      f.tEnd = now; f.ok = ix.ok !== false;
      if (f.showAt > now && !(ix.n >= IXFX.GATE_N)) { this.fx.delete(key); return false; } // 짧게 끝난 반복은 조용히
    }
    if (ix.cat === 'user') { // 사용자 콘솔 상태(뿌리마다)
      const root = f.root !== undefined ? f.root : rootOf ? rootOf(f.nodeId) : null;
      f.root = root;
      const c = this.console.get(root) || { lastAt: now, replyAt: null, promptAt: null, asking: 0, failAt: null };
      c.lastAt = now;
      if (ix.op === 'prompt' || ix.op === 'command' || ix.op === 'midturn') { c.promptAt = now; c.replyAt = null; }
      if (ix.op === 'reply') c.replyAt = now;
      if (ix.op === 'ask') c.asking = ix.phase === 'end' ? 0 : 1;
      if (ix.op === 'deny' || ix.op === 'interrupt') c.failAt = now;
      this.console.set(root, c);
    }
    if (ix.cat === 'github') {
      const root = f.root !== undefined ? f.root : rootOf ? rootOf(f.nodeId) : null;
      const p = this.portal.get(root) || { lastAt: now, ciFailAt: null };
      p.lastAt = now;
      if (ix.phase === 'end' && ix.ci && ix.ci.fail) p.ciFailAt = now;
      this.portal.set(root, p);
      f.root = root;
    }
    this.dirtyAt = now;
    return true;
  }
  _cap(nodeId) {
    for (const user of [false, true]) {
      const mine = [...this.fx.values()].filter((f) => f.nodeId === nodeId && (f.cat === 'user') === user).sort((a, b) => a.seq - b.seq);
      while (mine.length > (user ? IXFX.USER_PER_NODE : IXFX.PER_NODE)) this.fx.delete(mine.shift().key);
    }
    if (this.fx.size > IXFX.MAX) {
      const all = [...this.fx.values()].sort((a, b) => (a.tEnd != null ? 0 : 1) - (b.tEnd != null ? 0 : 1) || a.seq - b.seq);
      while (this.fx.size > IXFX.MAX) this.fx.delete(all.shift().key);
    }
  }
  /** 끝난 지 오래된 효과 정리. 남은 효과 수 */
  step(now) {
    for (const [key, f] of this.fx) {
      if ((f.op === 'streak' || f.op === 'fan') && f.tEnd == null && now - f.lastAt > IXFX.IDLE_S) { f.tEnd = now; f.ok = true; f.ix = { ...f.ix, phase: 'end' }; }
      const lin = (f.cat === 'user' && f.op === 'auto' ? autoLinger(f.ix) : IXFX.LINGER[f.cat] || 2) / f.k + (f.cat === 'github' && f.ix.ci && f.ix.ci.fail ? IXFX.CI_AFTERGLOW : 0);
      if (f.tEnd != null && now - f.tEnd > lin) { this.fx.delete(key); continue; }
      if (f.tEnd == null && now - f.lastAt > (f.ix.bg ? IXFX.TTL_BG_S : IXFX.TTL_S)) this.fx.delete(key);
    }
    for (const [r, p] of this.portal) if (now - p.lastAt > IXFX.PORTAL_S) this.portal.delete(r);
    return this.fx.size;
  }
  /** 노드가 사라지면 그 효과도 */
  dropNode(id) { for (const [k, f] of this.fx) if (f.nodeId === id) this.fx.delete(k); }
  /** 그릴 것이 움직이는 중인가(2D 갱신 주기) */
  animating(now) { for (const f of this.fx.values()) if (now >= f.showAt) return true; for (const c of this.console.values()) if (c.asking || (c.replyAt != null && now - c.replyAt < 30)) return true; for (const p of this.portal.values()) if (p.ciFailAt != null && now - p.ciFailAt < 12) return true; return false; }
  /** 처리율(초당, 최근 진행 표본) */
  static rate(f) {
    const h = f.hist; if (h.length < 2) return null;
    const [t0, i0] = h[0], [t1, i1] = h[h.length - 1];
    return t1 > t0 ? (i1 - i0) / (t1 - t0) : null;
  }
}

// ───────────────────────── 도형 목록 ─────────────────────────
export const IXGEO = { LINES: 3000, QUADS: 900, LABELS: 10, CLABELS: 24 };
/** 굵은 선 화면 폭(px, F1): 기본 · 상위 활동·포커스·카메라 대상(env.vip) */
export const IX_LINE_PX = { BASE: 2, VIP: 3 };
/** F2 스테이션 화면 하한: 상위 활동·포커스·카메라 대상의 스테이션 폭이 화면에서 MIN_PX 보다 작으면 앵커 중심으로 키움(최대 MAX 배) */
export const IX_MIN_PX = 48;
export const IX_SCALE_MAX = 3;
/** 스테이션 배율 = clamp(IX_MIN_PX / (폭 × ppu), 1, IX_SCALE_MAX). ppu 0(vip 아님)·폭 0 이면 1 */
export function ixScale(ppu, width) {
  if (!(ppu > 0) || !(width > 0)) return 1;
  return Math.min(IX_SCALE_MAX, Math.max(1, IX_MIN_PX / (width * ppu)));
}
/**
 * F3 흐름 3D 바닥 스테이션(env.floorY 가 있을 때): 노드 발밑 무대(그린 반지름 R × FOOT_K ≈ 칩 반지름 × 1.8) 둘레의 정해진 세계 방위.
 * 각도 = +x 에서 +z 쪽으로(라디안). 기본 카메라는 +z 쪽에서 −z 를 본다 — db 오른쪽 뒤 · tests 왼쪽 뒤 · batch 앞 호 · remote(메인) 콘솔(−x,−z) 반대쪽.
 * 홀로그램 패널(노드 높이 · 화면 평면 8방향)과 높이가 달라 겹치지 않는다. LIFT = 바닥에서 띄움(대상 판·격자와 z 싸움 없음)
 */
export const IX_FLOOR = {
  FOOT_K: 2.4, LIFT: 0.06,
  ANG: { db: -0.6, tests: Math.PI + 0.6, batch: Math.PI / 2, remote: 0.22 },
  TEST: { CS: 0.55, GAP: 0.12 }, BATCH: { CS: 0.6, GAP: 0.12, ROW: 20 }, DB: { R: 0.7 }, HOST: 1.8,
  REMOTE_L: 7.5, REMOTE_MAX: 13,
};
/**
 * Planet 3D 갑판 스테이션(env.deck 이 있을 때 — IxLayer 의 Planet 만 준다, 2D Planet 은 예전 자리): 흐름 F3 와 같은 바닥 판·띠·실린더·터널을
 * 행성 아래 갑판(본체 밑 DROP_K × 반지름)에 둔다. 예전 Planet 자리(본체 둘레 적도면 소행성대·점 구름·노드 높이 점프 게이트)는
 * 본체·궤도 고리·노드 라벨 위에 1～3px 점으로 흩어져 읽히지 않았다(2026-10-27 캡처 after-p0-planet).
 * 갑판 반지름 = 반지름 × max(FOOT_K, EXT_K × 궤도계 겉 반지름 배(env.ext)) — 궤도 고리 밖. 방위는 카메라 쪽(+z) 반원만 쓴다:
 * 셸 패널(0°, 오른쪽 · ix 는 늘 셸이라 늘 열림)·라벨(위)·뒤쪽 궤도 원반을 피해 화면에서 행성 아래로 온다.
 */
export const IX_PLANET = {
  DROP_K: 1.6, FOOT_K: 1.3, EXT_K: 0.6,
  K: 0.7, // 기본 크기(흐름 판 × K) — 행성 사이가 흐름 노드 사이보다 좁아 흐름 크기면 이웃 행성·라벨을 덮었다. 화면 하한(F2)은 K 를 곱한 폭으로 잰다
  ANG: { db: Math.PI / 2 - 0.85, tests: Math.PI / 2 + 0.85, batch: Math.PI / 2, remote: Math.PI / 2 - 0.35 },
};
/** 바닥 스테이션 자리: 발밑 중심 F 에서 범주 방위로 dist 만큼(fl.ang = 화면 종류별 방위표) */
function floorAt(fl, cat, dist) { const a = (fl.ang || IX_FLOOR.ANG)[cat]; return { x: fl.x + Math.cos(a) * dist, y: fl.y, z: fl.z + Math.sin(a) * dist, dx: Math.cos(a), dz: Math.sin(a) }; }
/** 스테이션 배율 = 화면 종류 기본 크기 k(흐름 1 · Planet IX_PLANET.K) × 화면 하한 배율(k 를 곱한 폭으로 잼 — 하한 48px 은 그대로) */
function flScale(fl, width) { const k = fl.k || 1; return k * ixScale(fl.ppu, width * k); }
/** 흐름 3D 입체 사용자 단말: 화면 반폭·반높이·뒤로 기운 각(rad)·베젤 두께·글줄을 화면 면 앞으로 띄우는 거리·빔 출발점 */
export const CON3D = { W: 1.2, H: 0.72, TILT: 0.14, BEZEL: 0.13, TEXT_OUT: 0.05, FACE_OUT: 0.16 }; // 홀로그램 콘솔 데스크: 떠 있는 화면은 조금만(8°) 뒤로 기움
/** 방위 yaw(0 = 앞이 +z) → 기운 화면 기저 {r 오른쪽, v 화면 위(뒤로 기울어짐), n 화면 법선(앞·약간 위)} */
export function conBasis(yaw, tilt = CON3D.TILT) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
  return { r: [cy, 0, -sy], v: [-sy * st, ct, -cy * st], n: [sy * ct, st, cy * ct] };
}
const CONSOLE_IDLE = { lastAt: 0, replyAt: null, promptAt: null, asking: 0, failAt: null }; // 사용자 이벤트 전 콘솔(처음부터 보임)
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const hash = (s) => { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return (h >>> 0) / 4294967296; };

/** 도형 버퍼(재사용): 선 = [x1,y1,z1,x2,y2,z2,색,알파], 사각 = [x,y,z,크기,색,알파], 라벨 = {x,y,z,text,key,alpha,cls} */
export class IxGeo {
  constructor() { this.L = new Float32Array(IXGEO.LINES * 6); this.LC = new Uint8Array(IXGEO.LINES); this.LA = new Float32Array(IXGEO.LINES); this.LW = new Uint8Array(IXGEO.LINES); this.Q = new Float32Array(IXGEO.QUADS * 4); this.QC = new Uint8Array(IXGEO.QUADS); this.QA = new Float32Array(IXGEO.QUADS); this.labels = []; this.cons = []; this.clabels = []; this.reset(); }
  reset() { this.nl = 0; this.nq = 0; this.labels.length = 0; this.dropped = 0; this.ka = 1; this.lw = IX_LINE_PX.BASE; this.cons.length = 0; this.clabels.length = 0; this.st = this.st || []; this.st.length = 0; this.stl = this.stl || []; this.stl.length = 0; }
  // ka = 지금 그리는 뿌리·노드의 프로젝트 페이드 투명도(env.fade) — 선·사각·라벨이 모두 곱한다
  // lw = 지금 그리는 선의 화면 폭(px, F1 — 3D 굵은 선만 쓰고 2D 는 무시)
  line(x1, y1, z1, x2, y2, z2, key, a) {
    a *= this.ka;
    if (a <= 0.004) return;
    if (this.nl >= IXGEO.LINES) { this.dropped++; return; }
    const o = this.nl * 6, L = this.L; L[o] = x1; L[o + 1] = y1; L[o + 2] = z1; L[o + 3] = x2; L[o + 4] = y2; L[o + 5] = z2;
    this.LC[this.nl] = IX_KEYS.indexOf(key); this.LA[this.nl] = Math.min(1, a); this.LW[this.nl] = this.lw; this.nl++;
  }
  quad(x, y, z, s, key, a) {
    a *= this.ka;
    if (a <= 0.004 || s <= 0) return;
    if (this.nq >= IXGEO.QUADS) { this.dropped++; return; }
    const o = this.nq * 4; this.Q[o] = x; this.Q[o + 1] = y; this.Q[o + 2] = z; this.Q[o + 3] = s;
    this.QC[this.nq] = IX_KEYS.indexOf(key); this.QA[this.nq] = Math.min(1, a); this.nq++;
  }
  /** 사용자 콘솔 이름표(효과 라벨과 따로, 상한 CLABELS): info = consoleLines 결과 */
  conLabel(x, y, z, info, root, key, a) { a *= this.ka; if (a > 0.05 && this.clabels.length < IXGEO.CLABELS) this.clabels.push({ x, y, z, text: info.text || '', status: info.status || '', state: info.state || 'idle', root, key, alpha: Math.min(1, a) }); }
  label(x, y, z, text, key, a, cls = '') { a *= this.ka; if (a > 0.05 && this.labels.length < IXGEO.LABELS) this.labels.push({ x, y, z, text, key, alpha: Math.min(1, a), cls }); }
  /** 수평 원(xz 평면) */
  circle(cx, cy, cz, r, key, a, seg = 28, from = 0, to = Math.PI * 2, tilt = 0) {
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i <= seg; i++) {
      const t = from + ((to - from) * i) / seg;
      const x = cx + Math.cos(t) * r, z = cz + Math.sin(t) * r, y = cy + Math.sin(t) * r * tilt;
      if (i) this.line(px, py, pz, x, y, z, key, a);
      px = x; py = y; pz = z;
    }
  }
  /** 세로 원(진행 방향 d 에 수직, 위 축 포함) */
  ring(cx, cy, cz, dx, dz, r, key, a, seg = 16) {
    const ln = Math.hypot(dx, dz) || 1, sx = -dz / ln, sz = dx / ln;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const x = cx + Math.cos(t) * r * sx, z = cz + Math.cos(t) * r * sz, y = cy + Math.sin(t) * r;
      if (i) this.line(px, py, pz, x, y, z, key, a);
      px = x; py = y; pz = z;
    }
  }
}

/** github 포털 자리: 흐름 = 뿌리 노드 위 하늘(오프셋·반지름), Planet = 뿌리 행성 둘레 통신 위성 궤도(뿌리 반지름 + ro, 높이 y) */
export const PORTAL = { flow: { x: 0.6, y: 6.5, z: -3.2, r: 1.9 }, planet: { ro: 3.4, y: 1.6, r: 0.9 } };
/**
 * 카메라 붙잡기가 화면에 함께 담을 포털 점 [{x,y,z,r}]: 흐름 = 포털 고리, Planet = 위성이 도는 궤도 네 점(위성이 어디 있든 담김).
 * rp = 뿌리 노드 세계 자리, rootR = 그린 반지름(ixGeometry 의 R 과 같은 값)
 */
export function ixPortalPts(theme, rp, rootR = 0.8) {
  if (!rp) return null;
  if (theme !== 'planet') { const F = PORTAL.flow; return [{ x: rp.x + F.x, y: (rp.y || 0) + F.y, z: rp.z + F.z, r: F.r + 0.4 }]; }
  const P = PORTAL.planet, ro = Math.max(0.4, rootR || 0.8) + P.ro, y = (rp.y || 0) + P.y;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: rp.x + a * ro, y, z: rp.z + b * ro, r: P.r }));
}

/**
 * IxModel → 도형. env:
 *   pos(id) → {x,y,z}|null (세계 좌표, 숨김·퇴장이면 null)  rad(id) → 그린 반지름  root(id) → 뿌리 노드 id
 *   theme 'flow'|'planet'  reduced(움직임 줄이기)  focusId
 */
export function ixGeometry(model, now, env, geo = new IxGeo()) {
  geo.reset();
  const flow = env.theme !== 'planet';
  const R = (id) => Math.max(0.4, env.rad(id) || 0.8);
  // ---- 포털(github): 뿌리마다 하나 ----
  const portalPos = new Map();
  const portalAt = (rootId) => {
    if (portalPos.has(rootId)) return portalPos.get(rootId);
    const rp = rootId != null ? env.pos(rootId) : null;
    if (!rp) { portalPos.set(rootId, null); return null; }
    let c;
    const F = PORTAL.flow, P = PORTAL.planet;
    if (flow) c = { x: rp.x + F.x, y: rp.y + F.y, z: rp.z + F.z, r: F.r };
    else { const a = (env.reduced ? 0 : now * 0.35) + hash(rootId) * 6.28, ro = R(rootId) + P.ro; c = { x: rp.x + Math.cos(a) * ro, y: rp.y + P.y + Math.sin(a * 0.5) * 0.4, z: rp.z + Math.sin(a) * ro, r: P.r, rp, ro }; }
    portalPos.set(rootId, c);
    return c;
  };
  const fadeOf = (id) => (env.fade ? env.fade(id) : 1); // 프로젝트 페이드
  for (const [rootId, p] of model.portal) {
    const c = portalAt(rootId);
    if (!c) continue;
    geo.ka = fadeOf(rootId);
    let busy = 0;
    for (const f of model.fx.values()) if (f.cat === 'github' && f.root === rootId && now >= f.showAt) busy = Math.max(busy, f.tEnd == null ? 0.55 : 0.55 * (1 - clamp01((now - f.tEnd) / 2.5)));
    const ciFail = p.ciFailAt != null ? now - p.ciFailAt : Infinity;
    const failA = ciFail < 4 ? 0.35 + 0.35 * Math.abs(Math.sin(ciFail * 7)) : ciFail < 4 + IXFX.CI_AFTERGLOW ? 0.35 * (1 - (ciFail - 4) / IXFX.CI_AFTERGLOW) : 0;
    if (flow) { // F4 평소엔 안 그림 — github 활동(busy) 중이거나 CI 실패 잔광 때만(예전 평소 알파 0.07 은 1px 선이라 사실상 안 보이고 화면만 흐렸다)
      if (busy <= 0.01 && failA <= 0.05) continue;
      const spin = env.reduced ? 0 : now * 0.4;
      geo.circle(c.x, c.y, c.z, c.r, failA > 0.05 ? 'err' : 'github', Math.max(busy, failA), 36);
      geo.circle(c.x, c.y, c.z, c.r * 0.82, 'github', busy * 0.5, 30, spin, spin + Math.PI * 1.4);
    } else {
      geo.circle(c.rp.x, c.rp.y + 1.6, c.rp.z, c.ro, 'github', 0.05 + busy * 0.25, 40, 0, Math.PI * 2, 0.12); // 궤도
      geo.quad(c.x, c.y, c.z, 0.34, failA > 0.05 ? 'err' : 'github', 0.35 + busy);
      geo.line(c.x - 0.45, c.y, c.z, c.x + 0.45, c.y, c.z, 'github', 0.3 + busy); // 태양 전지판
      if (failA > 0.05) geo.circle(c.x, c.y, c.z, 0.6, 'err', failA, 18);
    }
  }
  // ---- 사용자 콘솔: 섬 위 사용자 쪽 작은 단말(Planet = 지상 관제소 + 작은 화면).
  //      메인마다 처음부터(env.consoleRoots — 사용자 이벤트를 기다리지 않음). 평소에도 화면 안 글줄 + 위 이름표(마지막 입력 첫 몇 단어 · 상태 · 시간, env.consoleInfo),
  //      답변 뒤 '읽음 대기' 맥동, 오래 쉬면 조금 어두워짐(찾을 수 있게 하한 0.6). 집기용 자리는 geo.cons ----
  const consolePos = new Map();
  const consoleAt = (rootId) => {
    if (consolePos.has(rootId)) return consolePos.get(rootId);
    const rp = rootId != null ? env.pos(rootId) : null;
    let c = null;
    if (rp) {
      if (flow) {
        c = { x: rp.x - 4.6, y: rp.y + 5.2, z: rp.z - 3.4 };
        // 흐름 3D 입체 단말(env.solid): 화면이 카메라 쪽 방위(env.conYaw)로 서서 뒤로 CON3D.TILT 기울어짐.
        // 화면 가운데 S = 예전 자리, 기저 r(오른쪽)·v(화면 위)·n(화면 법선). 빔·리본·패킷은 화면 앞(n × FACE_OUT)에서 출발
        if (env.solid) {
          const S = { x: c.x, y: c.y, z: c.z };
          const yaw = env.conYaw ? env.conYaw(rootId, S) : 0;
          const B = conBasis(yaw);
          c = { x: S.x + B.n[0] * CON3D.FACE_OUT, y: S.y + B.n[1] * CON3D.FACE_OUT, z: S.z + B.n[2] * CON3D.FACE_OUT, S, yaw, ...B };
        }
      }
      else { const rr = R(rootId); c = { x: rp.x - rr * 0.55, y: rp.y + rr * 0.95, z: rp.z, mast: { x: rp.x - rr * 0.45, y: rp.y + rr * 0.7, z: rp.z }, rr }; }
    }
    consolePos.set(rootId, c);
    return c;
  };
  const roots = new Set(model.console.keys());
  if (env.consoleRoots) for (const r of env.consoleRoots()) roots.add(r);
  for (const rootId of roots) {
    const c = consoleAt(rootId);
    if (!c) continue;
    const cs = model.console.get(rootId) || CONSOLE_IDLE;
    const info = env.consoleInfo ? env.consoleInfo(rootId) : null;
    const asking = cs.asking || (info && info.state === 'asking') ? 1 : 0;
    geo.ka = fadeOf(rootId);
    const since = cs.replyAt != null ? now - cs.replyAt : null;
    const dim = since == null ? 1 : Math.max(0.6, 1 - since / IXFX.CONSOLE_DIM_S); // 오래 기다리면 조금 어두워짐(찾을 수 있게)
    const waitPulse = since != null && since < 30 ? 0.18 * (0.5 + 0.5 * Math.sin(now * 2.4)) * (1 - since / 30) : 0; // 읽음 대기
    const fail = cs.failAt != null && now - cs.failAt < 1.5 ? 1 - (now - cs.failAt) / 1.5 : 0;
    const key = fail > 0.05 ? 'err' : 'user';
    const a = (((flow ? 0.26 : 0.34) + waitPulse + (asking ? 0.2 + 0.15 * Math.sin(now * 5) : 0)) * dim + fail * 0.6) * (env.light ? 1.7 : 1); // 라이트는 배경 쪽 섞임이라 진하게
    // 화면(가운데 sx,sy,sz · 반폭 w · 반높이 h). 화면 위 점 = P(u, v): 기본은 xy 평면, 입체 단말은 기운 화면 면(앞으로 조금 띄워 면과 겹치지 않게)
    let sx, sy, sz, w, h;
    const B = c.S ? c : null;
    if (B) { sx = B.S.x; sy = B.S.y; sz = B.S.z; w = CON3D.W; h = CON3D.H; } // 틀·받침·기둥·상태등은 3D 단말 메시(flowview/console3d.js)가 그림
    else if (flow) {
      w = 1.2; h = 0.72; sx = c.x; sy = c.y; sz = c.z;
      geo.line(sx - 0.25, sy - h - 0.2, sz, sx + 0.25, sy - h - 0.2, sz, key, a * 0.7); // 받침
      geo.line(sx, sy - h, sz, sx, sy - h - 0.2, sz, key, a * 0.5);
    } else {
      geo.line(c.mast.x, c.mast.y, c.mast.z, c.x, c.y, c.z, key, a);   // 관제소 안테나
      geo.circle(c.x, c.y + 0.12, c.z, 0.46, key, a, 14, Math.PI, Math.PI * 2, 0.9); // 접시
      geo.quad(c.x, c.y + 0.1, c.z, 0.2 + waitPulse * 0.3, key, Math.min(1, a * 2.2));
      w = 0.6; h = 0.36; sx = c.x - (c.rr || 1) * 0.8 - 1.3; sy = c.y + (c.rr || 1) * 0.45 + 0.45; sz = c.z; // 관제소 옆 작은 화면(행성 고리 밖으로)
      geo.line(sx + w, sy - h * 0.4, sz, c.x - 0.1, c.y, c.z, key, a * 0.45);
    }
    const P = B ? (u, v, o = CON3D.TEXT_OUT) => [sx + B.r[0] * u + B.v[0] * v + B.n[0] * o, sy + B.v[1] * v + B.n[1] * o, sz + B.r[2] * u + B.v[2] * v + B.n[2] * o] : (u, v) => [sx + u, sy + v, sz];
    const ln = (u1, v1, u2, v2, k, al) => { const p = P(u1, v1), q = P(u2, v2); geo.line(p[0], p[1], p[2], q[0], q[1], q[2], k, al); };
    if (!B) { ln(-w, -h, w, -h, key, a); ln(w, -h, w, h, key, a); ln(w, h, -w, h, key, a); ln(-w, h, -w, -h, key, a); }
    // 화면 안 글줄(비어 보이지 않게): 첫 줄 = 마지막 입력 길이, 둘째 줄 = 상태 막대(작업 중이면 그 위를 점이 흐름)
    const st = info ? info.state : 'idle';
    const l1 = info && info.text ? 0.35 + 0.55 * Math.min(1, info.text.length / 22) : 0.18;
    const x0 = -w * 0.78, lw = w * 1.56;
    if (!B) { // 흐름 3D 홀로그램 콘솔(입체 모드)은 화면에 글이 바로 뜸(flowview/console3d.js 글 텍스처) — 글줄 막대는 선 단말(2D 밖 Planet)만
      ln(x0, h * 0.32, x0 + lw * l1, h * 0.32, key, a * 0.85);
      if (info && info.text) ln(x0, -h * 0.02, x0 + lw * l1 * 0.62, -h * 0.02, key, a * 0.55);
      const l2 = st === 'idle' ? 0.3 : 0.55;
      ln(x0, -h * 0.4, x0 + lw * l2, -h * 0.4, st === 'asking' ? 'user' : key, a * 0.5);
      if (st === 'working' && !env.reduced) { const q = P(x0 + lw * l2 * ((now * 0.45) % 1), -h * 0.4); geo.quad(q[0], q[1], q[2], 0.09, key, Math.min(1, a * 2)); }
    }
    if (flow && !B) geo.quad(sx + w * 0.78, sy + h * 0.62, sz, 0.14 + waitPulse * 0.4 + (asking ? 0.08 : 0), key, Math.min(1, a * 2.2)); // 빛나는 별(상태 등) — 입체 단말은 베젤 표시등
    const con = { root: rootId, x: sx, y: sy, z: sz, w, h, a, state: st };
    if (B) { con.r = B.r; con.v = B.v; con.n = B.n; con.yaw = B.yaw; con.fade = geo.ka; con.key = key; con.pulse = waitPulse; con.asking = asking; con.dim = dim; con.fail = fail; }
    geo.cons.push(con);
    if (info) { const L = B ? P(0, h + CON3D.BEZEL, 0) : [sx, sy + h + 0.12, sz]; geo.conLabel(L[0], L[1] + (B ? 0.14 : 0), L[2], info, rootId, key, Math.min(1, 0.55 + a)); }
  }
  // ---- 효과 ----
  for (const f of model.fx.values()) {
    if (now < f.showAt) continue;
    const id = f.bgNode && !env.pos(f.nodeId) ? f.bgNode : f.nodeId;
    const P = env.pos(id);
    if (!P) continue;
    geo.ka = fadeOf(id);
    geo.lw = env.vip && env.vip(id) ? IX_LINE_PX.VIP : IX_LINE_PX.BASE;
    const r = R(id);
    const t = now - f.t0, te = f.tEnd != null ? now - f.tEnd : null;
    const lin = (IXFX.LINGER[f.cat] || 2) / f.k;
    const fade = te == null ? 1 : 1 - clamp01((te - lin * 0.6) / (lin * 0.4));
    const appear = ease(t / 0.4);
    const A = appear * fade;
    if (A <= 0.01) continue;
    const ix = f.ix;
    // F3 바닥 스테이션 자리(흐름 3D): 발밑 중심 · 무대 반지름 · 화면 하한용 ppu(F2) · 섬 가장자리까지 거리(remote)
    //    Planet 3D(env.deck)는 같은 스테이션을 행성 아래 갑판에(IX_PLANET) — 흐름 값은 그대로
    const st = f.cat !== 'github' && f.cat !== 'user';
    const fl = st && flow && env.floorY != null
      ? { x: P.x, y: env.floorY + IX_FLOOR.LIFT, z: P.z, R: r * IX_FLOOR.FOOT_K, ppu: env.ppu ? env.ppu(id) : 0, edge: env.edge ? (dx, dz) => env.edge(id, dx, dz) : null, lin, ang: IX_FLOOR.ANG }
      : st && !flow && env.deck
        ? { x: P.x, y: P.y - r * IX_PLANET.DROP_K, z: P.z, R: r * Math.max(IX_PLANET.FOOT_K, IX_PLANET.EXT_K * ((env.ext && env.ext(id)) || 1)), ppu: env.ppu ? env.ppu(id) : 0, edge: env.edge ? (dx, dz) => env.edge(id, dx, dz) : null, lin, ang: IX_PLANET.ANG, k: IX_PLANET.K }
        : null;
    const nl0 = geo.nl, nq0 = geo.nq, nb0 = geo.labels.length; // 스테이션(바닥·갑판) 도형 범위 — 노드 라벨 아래 칸을 옅게(ixDimUnderLabels) · 글자(점수 배지 등) 범위
    switch (f.cat) {
      case 'github': drawGithub(geo, f, ix, P, r, portalAt(f.root), t, te, A, now, flow, env); break;
      case 'db': if (fl) drawDbFloor(geo, f, ix, P, r, t, te, A, now, env, fl); else drawDb(geo, f, ix, P, r, t, te, A, now, flow); break;
      case 'remote': drawRemote(geo, f, ix, P, r, t, te, A, now, flow, env, lin, fl); break;
      case 'batch': drawBatch(geo, f, ix, P, r, t, te, A, now, flow, env, fl); break;
      case 'tests': drawTests(geo, f, ix, P, r, t, te, A, now, flow, env, fl); break;
      case 'user': drawUser(geo, f, ix, P, r, consoleAt(f.root), t, te, A, now, flow, env, model); break;
    }
    if (fl && (geo.nl > nl0 || geo.nq > nq0)) geo.st.push(nl0, geo.nl, nq0, geo.nq);
    if (fl && geo.labels.length > nb0) geo.stl.push(nb0, geo.labels.length);
  }
  geo.ka = 1; geo.lw = IX_LINE_PX.BASE;
  return geo;
}

/**
 * 스냅샷 씨앗: 외부 작업(meta.job.src 'ext') 노드가 진행을 들고 들어오면 그 바닥·갑판 진행 띠를 바로 세울 output 이벤트
 * (서버 `extJobIx` 와 같은 꼴 — 진행 줄 i/N 또는 예상 비율 pct). 끝난 작업·진행 없음·다른 작업은 null.
 * 원인: 진행 띠는 output 이벤트(ix)로만 그려 화면을 연 직후(스냅샷에는 ix 가 없다) 다음 진행 이벤트(≤1분)까지 비어 있었다.
 */
export function ixSeedEvent(node) {
  const job = node && node.meta && node.meta.job;
  if (!job || job.src !== 'ext' || job.state === 'done' || job.state === 'failed') return null;
  const p = job.progress;
  let core = null;
  if (p && Number.isFinite(p.n) && Number(p.total) > 0) core = { i: p.n, n: Number(p.total) };
  else if (p && Number.isFinite(p.ratio) && job.ext && Number(job.ext.expectSec) > 0) core = { pct: Math.min(99, Math.floor(p.ratio * 100)) };
  if (!core) return null;
  return { type: 'output', ts: job.beatAt || null, nodeId: node.id, text: '', ix: { v: 1, cat: 'batch', op: 'progress', bg: 1, ...core, phase: 'progress' }, seed: true };
}

/** 노드 라벨 아래 스테이션 칸의 알파 배율(라벨 글자가 밝은 칸 위에 얹혀 안 읽히던 것 — 흐름 바닥·Planet 갑판 공통)
 *  LAB = 스테이션 글자(점수 배지·진행 눈금·호스트 이름)가 노드 라벨과 겹칠 때의 불투명도 배율 */
export const IX_UNDER_LABEL = { K: 0.12, PAD: 4, LAB: 0.2 };
/** 스테이션 글자 크기 추정(px, 아직 재지 않은 첫 프레임용): 글자 수 × 6.6(배지 7.2) + 여백, 높이 15(배지 19) */
export function ixLabelSizeGuess(text, cls = '') { const b = /ix-badge/.test(cls); return [String(text || '').length * (b ? 7.2 : 6.6) + (b ? 14 : 4), b ? 19 : 15]; }
/** 화면 사각형(가운데 x,y · 반폭 hw · 반높이 hh)이 상자들([x0,y0,x1,y1], 여백 pad) 가운데 하나와 겹치는지 */
export function ixRectHits(x, y, hw, hh, boxes, pad = IX_UNDER_LABEL.PAD) {
  for (const b of boxes) if (x + hw >= b[0] - pad && x - hw <= b[2] + pad && y + hh >= b[1] - pad && y - hh <= b[3] + pad) return true;
  return false;
}
/** 화면 선분 (ax,ay)–(bx,by) 가 상자 [x0,y0,x1,y1] 를 지나는지(Liang–Barsky) */
export function segHitsBox(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const P = [-dx, dx, -dy, dy], Qv = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Qv[i] < 0) return false; continue; }
    const r = Qv[i] / P[i];
    if (P[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}
/**
 * 스테이션(바닥·갑판 — geo.st 범위) 점·선이 화면에서 노드 라벨 상자에 걸치면 알파를 IX_UNDER_LABEL.K 배로.
 * toScreen(x, y, z, out) → true/false(카메라 뒤), out{x,y} 화면 px, out.k(있으면) = 그 깊이의 세계 1단위당 px.
 * 예전엔 점·선 **가운데**만 봤다 — 화면 하한(F2)으로 커진 점수판 칸(지름 수십 px)은 가운데가 상자 밖이어도 라벨 글자를 덮었다.
 * 이제 점은 화면 반지름(크기/2 × k), 선은 두 끝을 이은 선분(화면 폭 절반)으로 상자와 겹치는지 본다(k 가 없으면 예전처럼 가운데만).
 * labSize(i) → [w, h](px) 를 주면 스테이션 글자(geo.stl 범위, 화면 가운데 정렬)도 상자에 걸칠 때 alpha × LAB.
 * boxes = [[x0,y0,x1,y1], …](화면 px). 옅게 한 개수를 돌려준다.
 */
export function ixDimUnderLabels(geo, toScreen, boxes, k = IX_UNDER_LABEL.K, pad = IX_UNDER_LABEL.PAD, labSize = null) {
  if (!geo.st || !boxes || !boxes.length) return 0;
  const o = { x: 0, y: 0, k: 0 }, o2 = { x: 0, y: 0, k: 0 };
  const hitRect = (x, y, hw, hh) => ixRectHits(x, y, hw, hh, boxes, pad);
  let n = 0;
  for (let i = 0; i < geo.st.length; i += 4) {
    for (let j = geo.st[i]; j < geo.st[i + 1]; j++) {
      const q = j * 6, L = geo.L, hw = (geo.LW ? geo.LW[j] : 2) / 2;
      let hit = false;
      if (toScreen(L[q], L[q + 1], L[q + 2], o) && toScreen(L[q + 3], L[q + 4], L[q + 5], o2)) {
        for (const b of boxes) if (segHitsBox(o.x, o.y, o2.x, o2.y, b[0] - pad - hw, b[1] - pad - hw, b[2] + pad + hw, b[3] + pad + hw)) { hit = true; break; }
      } else if (toScreen((L[q] + L[q + 3]) / 2, (L[q + 1] + L[q + 4]) / 2, (L[q + 2] + L[q + 5]) / 2, o)) hit = hitRect(o.x, o.y, 0, 0);
      if (hit) { geo.LA[j] *= k; n++; }
    }
    for (let j = geo.st[i + 2]; j < geo.st[i + 3]; j++) {
      const q = j * 4;
      o.k = 0;
      if (!toScreen(geo.Q[q], geo.Q[q + 1], geo.Q[q + 2], o)) continue;
      const r = o.k > 0 ? (geo.Q[q + 3] / 2) * o.k : 0;
      if (hitRect(o.x, o.y, r, r)) { geo.QA[j] *= k; n++; }
    }
  }
  if (labSize && geo.stl) for (let i = 0; i < geo.stl.length; i += 2) {
    for (let j = geo.stl[i]; j < geo.stl[i + 1]; j++) {
      const d = geo.labels[j];
      if (!d || !toScreen(d.x, d.y, d.z, o)) continue;
      const sz = labSize(j, d);
      if (sz && hitRect(o.x, o.y, sz[0] / 2, sz[1] / 2)) { d.alpha *= IX_UNDER_LABEL.LAB; n++; }
    }
  }
  return n;
}

function drawUser(geo, f, ix, P, r, C, t, te, A, now, flow, env, model) {
  const top = { x: P.x, y: P.y + r * 0.5, z: P.z };
  const T = te != null ? te : t;
  if (ix.op === 'auto') { drawAuto(geo, ix, P, r, top, T, A, env); return; } // 예약·Monitor·작업 알림(회색 점은 그 밖)
  if (ix.op === 'deny' || ix.op === 'interrupt') { // 붉은 파문
    for (const d of [0, 0.22]) { const q = (T - d) / 0.9; if (q > 0 && q < 1) geo.circle(P.x, P.y, P.z, r * (1.1 + q * 1.6), 'err', A * (1 - q) * 0.9, 28); }
    if (C && ix.op === 'interrupt') { const u = T / 0.6; if (u < 1) travel(geo, C, top, u, 'err', A * 0.8, 0.14, 0.2); }
    return;
  }
  if (ix.op === 'reply') { // 메인 → 콘솔로 되돌아가는 빛
    if (!C) return;
    for (let k = 0; k < 3; k++) { const u = (T - k * 0.12) / 0.9; if (u > 0 && u < 1) travel(geo, top, C, ease(u), 'user', A * 0.8, 0.15, 0.6); }
    return;
  }
  if (ix.op === 'ask') { // 메인 위 물음표 신호등 + 선택지 점
    const B = { x: P.x, y: P.y + r + 1.4, z: P.z - r * 0.6 };
    const n = Math.max(1, Math.min(8, ix.opts || 2));
    const done = te != null;
    for (let i = 0; i < n; i++) {
      const x = B.x + (i - (n - 1) / 2) * 0.32;
      const pick = done && ix.pick === i;
      geo.quad(x, B.y - 0.42, B.z, pick ? 0.22 : 0.13, done ? (pick ? 'user' : 'dim') : 'user', A * (done ? (pick ? 1 : 0.25) : 0.35 + 0.25 * Math.sin(now * 3 + i)));
    }
    geo.label(B.x, B.y, B.z, done ? (ix.declined ? '✕' : ix.pick != null ? `${ix.pick + 1}` : '✓') : '?', done && ix.declined ? 'err' : 'user', A * (done ? 1 : 0.7 + 0.3 * Math.sin(now * 4)), 'ix-badge');
    if (done && !ix.declined && C) { const u = te / 0.8; if (u < 1) beamLine(geo, C, top, 'user', A * 0.5 * (1 - u * 0.5), 10, 0.5); if (u < 1) travel(geo, C, top, ease(u), 'user', A, 0.17, 0.5); }
    return;
  }
  // prompt·command·midturn: 콘솔에서 메인으로 내려오는 금빛 빔 + 첫 몇 단어 리본 + 메인이 깨어나는 파문
  if (C) {
    const beamA = A * Math.max(0, 0.55 - Math.max(0, t - 0.9) * 0.35);
    if (beamA > 0.01) beamLine(geo, C, top, 'user', beamA, 12, 0.5);
    const u = t / 0.9;
    if (u < 1) { travel(geo, C, top, ease(u), 'user', A, 0.2, 0.5); }
    if (ix.text && t < 2.2) { const uu = ease(Math.min(1, t / 1.0)); geo.label(C.x + (top.x - C.x) * uu, C.y + (top.y - C.y) * uu + Math.sin(uu * Math.PI) * 0.5 + 0.35, C.z + (top.z - C.z) * uu, ix.text.length > 18 ? ix.text.slice(0, 17) + '…' : ix.text, 'user', A * (t < 1.6 ? 1 : 1 - (t - 1.6) / 0.6), 'ix-ribbon'); }
  }
  if (ix.op === 'midturn') { // 진행 중인 메인 옆에 카드가 겹쳐 쌓였다가 흡수
    let k = 0; for (const g of model.fx.values()) if (g !== f && g.nodeId === f.nodeId && g.op === 'midturn' && g.seq < f.seq && now - g.t0 < 2.4) k++;
    const absorb = clamp01((t - 1.4) / 0.6);
    const cx = P.x + (r + 0.8) * (1 - absorb), cy = P.y + 0.3 + k * 0.16 * (1 - absorb), cz = P.z - k * 0.08;
    const w = 0.42 * (1 - absorb * 0.6), h = 0.28 * (1 - absorb * 0.6);
    for (const [x1, y1, x2, y2] of [[-w, -h, w, -h], [w, -h, w, h], [w, h, -w, h], [-w, h, -w, -h]]) geo.line(cx + x1, cy + y1, cz, cx + x2, cy + y2, cz, 'user', A * 0.8 * (1 - absorb));
    if (absorb >= 1) { const q = clamp01((t - 2.0) / 0.6); if (q < 1) geo.circle(P.x, P.y, P.z, r * (1.1 + q), 'user', A * (1 - q) * 0.6, 24); }
    return;
  }
  const w0 = 0.85; // 메인이 한 번 크게 깨어나는 파문
  for (const d of [0, 0.2, 0.4]) { const q = (t - w0 - d) / 1.1; if (q > 0 && q < 1) geo.circle(P.x, P.y, P.z, r * (1.15 + q * 2.4), 'user', A * (1 - q) * 0.75, 32); }
}

/**
 * 자동 턴(사용자 콘솔 빔과 섞이지 않게 콘솔은 쓰지 않는다). 출처 노드(ix.from)가 보이면 그 노드 → 메인, 퇴장·숨김이면(env.pos null)
 * 메인 쪽 연출만. 모든 도형은 수평(xz) 원·선이라 2D 평면에서도 같은 모양으로 읽힌다.
 *   예약 = 메인 옆 시계(얼굴 원 + 바늘이 한 바퀴 돌며 울림 고리) → 시계에서 메인으로 빛 → 메인 깨어남 파문(청록) + '⏰ 첫 몇 단어' 리본
 *   Monitor = Monitor 노드에서 메인으로 보라 패킷 + 출력 첫 몇 단어 리본, 닿으면 작은 고리
 *   작업 결과 = 출처에서 메인으로 결과 패킷(ok 초록 · err 빨강 · stop 회색) → 메인 위 ✓·✕·■ 배지
 *   그 밖 = 회색 작은 점 하나(예전)
 */
function drawAuto(geo, ix, P, r, top, T, A, env) {
  const kind = ixAutoKind(ix);
  const rib = (x, y, z, key, a, glyph) => { if (ix.text && a > 0.02) geo.label(x, y, z, glyph + (ix.text.length > 18 ? ix.text.slice(0, 17) + '…' : ix.text), key, a, 'ix-ribbon'); };
  const ribA = (T < 2.2 ? 1 : 1 - (T - 2.2) / 0.6) * A;
  if (kind === 'dot') {
    const s = { x: P.x - r - 0.9, y: P.y + 0.5, z: P.z - r - 0.6 };
    const u = T / 0.9; if (u < 1) travel(geo, s, top, u, 'auto', A * 0.7, 0.09, 0.1);
    return;
  }
  const wake = (key, t0, n = 2) => { for (let i = 0; i < n; i++) { const q = (T - t0 - i * 0.2) / 1.0; if (q > 0 && q < 1) geo.circle(P.x, P.y, P.z, r * (1.12 + q * 1.8), key, A * (1 - q) * 0.7, 28); } };
  if (kind === 'schedule') {
    const R0 = IX_AUTO.CLOCK_R, K = { x: P.x + r + 0.9, y: P.y + r * 0.6 + 0.5, z: P.z - r * 0.4 };
    const ring = T < 1.3 ? 0.5 + 0.5 * Math.sin(T * 22) : 0; // 울림
    geo.circle(K.x, K.y, K.z, R0, 'sched', A * (0.75 + 0.25 * ring), 20);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; geo.line(K.x + Math.cos(a) * R0 * 0.78, K.y, K.z + Math.sin(a) * R0 * 0.78, K.x + Math.cos(a) * R0, K.y, K.z + Math.sin(a) * R0, 'sched', A * 0.8); }
    const ha = -Math.PI / 2 + (env.reduced ? 0 : clamp01(T / 1.3) * Math.PI * 2); // 분침이 한 바퀴
    geo.line(K.x, K.y, K.z, K.x + Math.cos(ha) * R0 * 0.85, K.y, K.z + Math.sin(ha) * R0 * 0.85, 'sched', A);
    geo.line(K.x, K.y, K.z, K.x + R0 * 0.5, K.y, K.z, 'sched', A * 0.85); // 시침
    if (ring > 0) for (const d of [-1, 1]) geo.circle(K.x, K.y, K.z, R0 * (1.25 + 0.12 * ring), 'sched', A * 0.6 * ring, 8, -Math.PI / 2 + d * 0.5 - 0.35, -Math.PI / 2 + d * 0.5 + 0.35);
    const u = (T - 0.9) / IX_AUTO.TRAVEL_S; if (u > 0 && u < 1) travel(geo, K, top, ease(u), 'sched', A, 0.16, 0.35);
    wake('sched', 0.9 + IX_AUTO.TRAVEL_S * 0.9);
    rib(K.x, K.y + 0.5, K.z, 'sched', ribA, '⏰ ');
    return;
  }
  const F = ix.from && env.pos ? env.pos(ix.from) : null;
  const key = kind === 'monitor' ? 'mon' : ix.st === 'err' ? 'err' : ix.st === 'stop' ? 'dim' : 'ok';
  const S = F && (F.x !== P.x || F.z !== P.z) ? { x: F.x, y: F.y + 0.35, z: F.z } : null;
  let arrive = 0;
  if (S) { // 출처 → 메인
    const u = T / IX_AUTO.TRAVEL_S;
    if (u < 1.4) beamLine(geo, S, top, key, A * 0.28 * (1 - clamp01((u - 0.6) / 0.8)), 10, 0.45);
    if (u < 1) travel(geo, S, top, ease(u), key, A, kind === 'monitor' ? 0.15 : 0.19, 0.45);
    if (u < 1) rib(S.x + (top.x - S.x) * ease(u), S.y + (top.y - S.y) * ease(u) + 0.55, S.z + (top.z - S.z) * ease(u), key, ribA, kind === 'monitor' ? '◎ ' : '');
    arrive = IX_AUTO.TRAVEL_S;
  } else rib(top.x, top.y + r * 0.6 + 0.5, top.z, key, ribA, kind === 'monitor' ? '◎ ' : ''); // 출처가 안 보이면 메인 쪽만
  const q = (T - arrive) / 0.7; if (q > 0 && q < 1) geo.circle(P.x, P.y, P.z, r * (1.1 + q * 0.9), key, A * (1 - q) * 0.8, 24);
  if (kind === 'result' && T > arrive) { // 메인 위 결과 배지
    const b = clamp01((T - arrive) / 0.25);
    geo.label(P.x, P.y + r + 0.9, P.z, ix.st === 'err' ? '✕' : ix.st === 'stop' ? '■' : '✓', key, A * b, 'ix-badge');
  } else if (kind === 'monitor') wake('mon', arrive, 1);
}

function travel(geo, a, b, u, key, alpha, size = 0.2, arc = 0.8) {
  u = clamp01(u);
  const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
  const y = a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * arc;
  geo.quad(x, y, z, size, key, alpha);
  // 짧은 꼬리
  const u2 = Math.max(0, u - 0.07);
  geo.line(a.x + (b.x - a.x) * u2, a.y + (b.y - a.y) * u2 + Math.sin(u2 * Math.PI) * arc, a.z + (b.z - a.z) * u2, x, y, z, key, alpha * 0.6);
}
function beamLine(geo, a, b, key, alpha, seg = 10, arc = 0.8) {
  let px = a.x, py = a.y, pz = a.z;
  for (let i = 1; i <= seg; i++) {
    const u = i / seg;
    const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, y = a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * arc;
    geo.line(px, py, pz, x, y, z, key, alpha);
    px = x; py = y; pz = z;
  }
}

function drawGithub(geo, f, ix, P, r, C, t, te, A, now, flow, env) {
  const top = { x: P.x, y: P.y + r * 0.6, z: P.z };
  if (ix.op === 'commit') { // 노드에 작은 도장 펄스
    if (te != null && f.ok) { const k = clamp01(te / 0.6); geo.circle(P.x, P.y, P.z, r * (1.2 + 0.6 * k), 'github', A * (1 - k) * 0.8, 24); geo.quad(top.x, top.y + 0.3, top.z, 0.18 * (1 - k * 0.5), 'github', A * (1 - k)); }
    else if (te == null) geo.circle(P.x, P.y, P.z, r * 1.2, 'github', A * 0.25, 24);
    return;
  }
  if (!C) return;
  const Cp = { x: C.x, y: C.y, z: C.z };
  if (ix.op === 'merge' || ix.op === 'rebase' || ix.op === 'pr-merge') { // 두 줄기가 합쳐지는 나선
    const k = te == null ? (t % 2) / 2 : clamp01(te / 1.1);
    const src = ix.op === 'pr-merge' ? Cp : { x: P.x - r * 2.5, y: P.y + 1.5, z: P.z - r * 2 };
    for (const s of [0, Math.PI]) {
      let px = 0, py = 0, pz = 0;
      for (let i = 0; i <= 22; i++) {
        const u = (i / 22) * (te == null ? 1 : ease(k * 1.2));
        const rad = (1 - u) * (flow ? 1.2 : 0.8);
        const a = s + u * Math.PI * 4 + now * 1.2;
        const x = src.x + (P.x - src.x) * u + Math.cos(a) * rad, y = src.y + (P.y - src.y) * u, z = src.z + (P.z - src.z) * u + Math.sin(a) * rad;
        if (i) geo.line(px, py, pz, x, y, z, f.ok === false ? 'err' : 'github', A * (0.25 + 0.5 * u));
        px = x; py = y; pz = z;
      }
    }
    if (te != null && f.ok) { const q = clamp01((te - 0.9) / 0.6); if (q > 0) geo.circle(P.x, P.y, P.z, r * (1.1 + q), 'github', A * (1 - q), 24); }
    if (ix.op === 'pr-merge' && ix.pr) geo.label(Cp.x, Cp.y + 0.9, Cp.z, tr('cards.ix.prMergedBadge', { pr: ix.pr }), 'github', A * (te == null ? 0.6 : 1), 'ix-badge');
    return;
  }
  if (ix.op === 'push') {
    const n = Math.min(12, Math.max(1, ix.commits || ix.commitsHere || 1));
    if (te == null) { // 노드 → 포털 빛줄기가 솟는 중
      beamLine(geo, top, Cp, 'github', A * (0.22 + 0.12 * Math.sin(now * 5)), 10, 0.4);
      travel(geo, top, Cp, (t * 0.9) % 1, 'github', A * 0.6, 0.16, 0.4);
    } else if (f.ok === false) {
      beamLine(geo, top, Cp, 'err', A * Math.max(0, 0.6 - te * 0.3) * (0.5 + 0.5 * Math.sin(te * 20)), 10, 0.4);
    } else {
      beamLine(geo, top, Cp, 'github', A * Math.max(0, 0.45 - te * 0.25), 10, 0.4);
      for (let k = 0; k < n; k++) { const u = (te - k * 0.14) / 0.7; if (u > 0 && u < 1) travel(geo, top, Cp, ease(u), 'github', A, 0.24, 0.4); }
      const tr = te - ((n - 1) * 0.14 + 0.7); // 공명·파문
      for (const d of [0, 0.25, 0.5]) { const q = (tr - d) / 1.2; if (q > 0 && q < 1) { if (flow) geo.circle(Cp.x, Cp.y, Cp.z, C.r * (1 + q * 1.4), 'github', A * (1 - q) * 0.9, 40); else geo.circle(Cp.x, Cp.y, Cp.z, 0.4 + q * 1.6, 'github', A * (1 - q) * 0.9, 24); } }
      if (ix.newBranch && te < 3) geo.label(Cp.x, Cp.y + 0.9, Cp.z, tr('cards.ix.newBranch'), 'github', A * 0.8, 'ix-badge');
    }
    return;
  }
  if (ix.op === 'pull' || ix.op === 'fetch' || ix.op === 'clone') { // 포털에서 비처럼
    const m = ix.upToDate ? 1 : Math.min(10, Math.max(3, ix.files || ix.refs || (ix.n ? 6 : 4)));
    const rainT = te == null ? (ix.op === 'clone' && ix.n ? t : -1) : te;
    if (te == null) beamLine(geo, Cp, top, 'github', A * 0.12, 8, 0);
    if (rainT >= 0) for (let k = 0; k < m; k++) {
      const h = hash(f.key + k), u = (rainT - k * 0.1 - (te == null ? Math.floor(rainT / 1.2) * 1.2 : 0)) / 0.8;
      if (u <= 0 || u >= 1) continue;
      const sx = Cp.x + Math.cos(h * 6.28) * (C.r || 0.8) * 0.8, sz = Cp.z + Math.sin(h * 6.28) * (C.r || 0.8) * 0.8;
      travel(geo, { x: sx, y: Cp.y, z: sz }, top, u * u, 'github', A * 0.9, 0.17, 0);
    }
    return;
  }
  if (ix.op === 'pr-create') { // 꽃처럼 열림 + #번호
    const k = te == null ? 0.25 + 0.1 * Math.sin(now * 3) : ease(te / 0.7);
    const pr = flow ? C.r : 0.7;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + now * 0.15;
      const tip = { x: Cp.x + Math.cos(a) * pr * (1 + 0.9 * k), y: Cp.y + 0.15 * k, z: Cp.z + Math.sin(a) * pr * (1 + 0.9 * k) };
      for (const s of [-0.32, 0.32]) { const b = { x: Cp.x + Math.cos(a + s) * pr, y: Cp.y, z: Cp.z + Math.sin(a + s) * pr }; geo.line(b.x, b.y, b.z, tip.x, tip.y, tip.z, 'github', A * (0.3 + 0.5 * k)); }
    }
    if (te != null) geo.label(Cp.x, Cp.y + 1.0, Cp.z, ix.pr ? `PR #${ix.pr}` : 'PR', 'github', A, 'ix-badge');
    return;
  }
  if (ix.op === 'pr-checks' || ix.op === 'run') { // 포털 둘레 점등 링
    const ci = ix.ci;
    const K = ci ? Math.min(24, Math.max(3, ci.pass + ci.fail + ci.pending + ci.skip)) : 12;
    const rr = (flow ? C.r : 0.7) * 1.28;
    for (let j = 0; j < K; j++) {
      const a = (j / K) * Math.PI * 2 - Math.PI / 2;
      let key = 'dim', al = 0.35;
      if (ci) {
        const tot = ci.pass + ci.fail + ci.pending + ci.skip || 1;
        const fr = (j + 0.5) / K, pf = ci.pass / tot, ff = (ci.pass + ci.fail) / tot, kf = (ci.pass + ci.fail + ci.pending) / tot;
        key = fr <= pf ? 'ok' : fr <= ff ? 'err' : fr <= kf ? 'warn' : 'skip';
        const lit = te == null ? 1 : clamp01((te - j * 0.05) / 0.2);
        al = 0.3 + 0.7 * lit;
        if (key === 'err' && te != null) al *= 0.6 + 0.4 * Math.abs(Math.sin(te * 6));
      } else { const sp = (now * 2) % K; al = 0.2 + 0.5 * Math.max(0, 1 - Math.abs(j - sp)); }
      geo.quad(Cp.x + Math.cos(a) * rr, Cp.y, Cp.z + Math.sin(a) * rr, 0.16, key, A * al);
    }
    if (ci && te != null) geo.label(Cp.x, Cp.y + 1.0, Cp.z, `CI ✓${ci.pass}${ci.fail ? ' ✗' + ci.fail : ''}`, ci.fail ? 'err' : 'ok', A, 'ix-badge');
    return;
  }
  // api·repo·view: 위로 한 번 핑
  const u = te == null ? (t % 1.4) / 0.7 : te / 0.7;
  if (u < 1) travel(geo, top, Cp, u, 'github', A * 0.5, 0.12, 0.3);
  else if (u < 2) travel(geo, Cp, top, u - 1, 'github', A * 0.5, 0.12, 0.3);
}

function drawDb(geo, f, ix, P, r, t, te, A, now, flow) {
  const w = ix.rw === 'w', rw = ix.rw === 'rw';
  if (flow) {
    const Q = { x: P.x + r + 1.5, y: P.y + 0.2, z: P.z - 0.4 };
    const cr = 0.42;
    for (const h of [0, 0.38, 0.76]) geo.circle(Q.x, Q.y + h, Q.z, cr, 'db', A * (h === 0.76 ? 0.55 : 0.32), 18, 0, Math.PI * 2, 0.35);
    geo.line(Q.x - cr, Q.y, Q.z, Q.x - cr, Q.y + 0.76, Q.z, 'db', A * 0.35);
    geo.line(Q.x + cr, Q.y, Q.z, Q.x + cr, Q.y + 0.76, Q.z, 'db', A * 0.35);
    if (te == null && t > 1.5) geo.circle(Q.x, Q.y + 0.38, Q.z, cr * 1.35, 'db', A * 0.45, 20, now * 2.5, now * 2.5 + Math.PI * 0.9, 0.35); // 긴 쿼리: 링 회전
    const near = { x: P.x + r * 0.9, y: P.y, z: P.z }, top = { x: Q.x, y: Q.y + 0.5, z: Q.z };
    dbBeams(geo, f, ix, near, top, t, te, A, w, rw);
    if (ix.rows != null && te != null) geo.label(Q.x, Q.y + 1.25, Q.z, tr('cards.ix.rows', { n: fmtN(Math.round(ix.rows * ease(te / 0.8))) }), w ? 'write' : 'read', A, 'ix-tick');
    else if (ix.db && te == null && t > 0.6) geo.label(Q.x, Q.y + 1.25, Q.z, ix.db, 'db', A * 0.7, 'ix-tick');
  } else { // Planet: 고리 위 데이터 소행성대
    const br = r + 1.25;
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + now * 0.5; geo.quad(P.x + Math.cos(a) * br, P.y + Math.sin(a) * br * 0.18, P.z + Math.sin(a) * br, 0.12 + 0.05 * hash(f.key + i), 'db', A * 0.6); }
    geo.circle(P.x, P.y, P.z, br, 'db', A * 0.18, 36, 0, Math.PI * 2, 0.18);
    const a = now * 0.5, rock = { x: P.x + Math.cos(a) * br, y: P.y + Math.sin(a) * br * 0.18 + 0.1, z: P.z + Math.sin(a) * br };
    dbBeams(geo, f, ix, { x: P.x, y: P.y + r * 0.3, z: P.z }, rock, t, te, A, w, rw);
    if (ix.rows != null && te != null) geo.label(P.x, P.y + r + 1.3, P.z, tr('cards.ix.rows', { n: fmtN(Math.round(ix.rows * ease(te / 0.8))) }), w ? 'write' : 'read', A, 'ix-tick');
  }
}
/** F3 흐름 3D db: 발밑 무대 오른쪽 뒤 바닥에 선 속 찬 실린더(높이 ∝ log 행 수). 읽기 = 실린더 → 노드(하늘색 방울), 쓰기 = 노드 → 실린더(주황) */
function drawDbFloor(geo, f, ix, P, r, t, te, A, now, env, fl) {
  const w = ix.rw === 'w', rw = ix.rw === 'rw';
  const s = flScale(fl, IX_FLOOR.DB.R * 2);
  const cr = IX_FLOOR.DB.R * s;
  const Q = floorAt(fl, 'db', fl.R + 0.5 * s + cr);
  const h0 = 1.4, hT = ix.rows != null ? Math.min(4, 0.9 + 0.55 * Math.log10(Math.max(0, ix.rows) + 1)) : h0;
  const h = (te != null && ix.rows != null ? h0 + (hT - h0) * ease(te / 0.8) : h0) * s;
  const n = Math.max(3, Math.min(8, Math.ceil(h / (0.3 * s))));
  for (let i = 0; i <= n; i++) { const y = Q.y + (h * i) / n; geo.circle(Q.x, y, Q.z, cr, 'db', A * (i === 0 || i === n ? 0.6 : 0.2), 14); } // 속 찬 몸통 = 촘촘한 수평 고리
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; geo.line(Q.x + Math.cos(a) * cr, Q.y, Q.z + Math.sin(a) * cr, Q.x + Math.cos(a) * cr, Q.y + h, Q.z + Math.sin(a) * cr, 'db', A * 0.3); }
  for (const k of [0.33, 0.66]) geo.circle(Q.x, Q.y + h, Q.z, cr * k, 'db', A * 0.3, 10); // 윗면
  if (te == null && t > 1.5) { // 긴 쿼리: 띠 회전(움직임 줄이기면 멈춘 띠)
    const a0 = env.reduced ? 0 : now * 2.5;
    geo.circle(Q.x, Q.y + h * 0.5, Q.z, cr * 1.35, 'db', A * 0.45, 20, a0, a0 + Math.PI * 0.9);
  }
  const node = { x: P.x, y: P.y - r * 0.5, z: P.z }, top = { x: Q.x, y: Q.y + h, z: Q.z };
  dbBeams(geo, f, ix, node, top, t, te, A, w, rw, 0.2 * Math.min(2, s));
  if (ix.rows != null && te != null) geo.label(Q.x, Q.y + h + 0.45, Q.z, tr('cards.ix.rows', { n: fmtN(Math.round(ix.rows * ease(te / 0.8))) }), w ? 'write' : 'read', A, 'ix-tick');
  else if (ix.db && te == null && t > 0.6) geo.label(Q.x, Q.y + h + 0.45, Q.z, ix.db, 'db', A * 0.7, 'ix-tick');
}
function dbBeams(geo, f, ix, node, store, t, te, A, w, rw, sz = 0.13) {
  // 읽기 = 차가운 색이 저장소 → 노드(아래로), 쓰기 = 따뜻한 색이 노드 → 저장소(위로)
  const go = (u, write) => travel(geo, write ? node : store, write ? store : node, u, write ? 'write' : 'read', A * 0.9, sz, 0.15);
  if (te == null) { const u = (t / 0.55) % 1; go(u, w || (rw && Math.floor(t / 0.55) % 2 === 1)); if (t > 0.3) go((u + 0.5) % 1, w); }
  else for (let k = 0; k < 3; k++) { const u = (te - k * 0.12) / 0.5; if (u > 0 && u < 1) go(u, w); }
  geo.line(node.x, node.y, node.z, store.x, store.y, store.z, w ? 'write' : 'read', A * 0.12);
}

/** 터널 방향: 뿌리에서 바깥쪽. 뿌리 자신(메인)은 기본 방향 — 바닥 모드(F3)는 콘솔(−x,−z) 반대 사분면, 그 밖은 예전 그대로 */
function remoteDir(f, P, env, floor = false, ang = IX_FLOOR.ANG) {
  const rootId = env.root ? env.root(f.nodeId) : null;
  const rp = rootId ? env.pos(rootId) : null;
  const a0 = ang.remote, dx0 = floor ? Math.cos(a0) : -1, dz0 = floor ? Math.sin(a0) : -0.6;
  let dx = rp ? P.x - rp.x : dx0, dz = rp ? P.z - rp.z : dz0;
  if (Math.hypot(dx, dz) < 0.5) { dx = dx0; dz = dz0; }
  const a = Math.atan2(dz, dx) + (hash(f.ix.host || f.key) - 0.5) * 0.9; // 호스트마다 조금씩 다른 방향
  return { x: Math.cos(a), z: Math.sin(a) };
}
/** F3 흐름 3D remote: 바닥 높이 터널(발밑 무대 가장자리 → 섬 가장자리), 끝에 호스트 표지 */
function drawRemoteFloor(geo, f, ix, P, r, t, te, A, now, env, open, fl) {
  const d = remoteDir(f, P, env, true, fl.ang || IX_FLOOR.ANG);
  const s = flScale(fl, IX_FLOOR.HOST);
  const e = fl.edge ? fl.edge(d.x, d.z) : null;
  const L = Math.max(fl.R + 4, Math.min(fl.R + IX_FLOOR.REMOTE_MAX, Number.isFinite(e) && e > 0 ? e : fl.R + IX_FLOOR.REMOTE_L));
  const S = { x: fl.x + d.x * fl.R, y: fl.y, z: fl.z + d.z * fl.R };
  const G = { x: fl.x + d.x * L, y: fl.y, z: fl.z + d.z * L };
  const key = te != null && f.ok === false ? 'err' : 'remote';
  for (let i = 0; i < 16; i += 2) { const u1 = i / 16, u2 = (i + 1) / 16; if (u2 > open) break; geo.line(S.x + (G.x - S.x) * u1, S.y, S.z + (G.z - S.z) * u1, S.x + (G.x - S.x) * u2, S.y, S.z + (G.z - S.z) * u2, key, A * 0.4); } // 바닥 점선 항로
  for (let i = 1; i <= 5; i++) { // 바닥에 선 고리(웜홀 게이트)
    const u = i / 5; if (u > open + 0.05) break;
    const rr = (0.3 + 0.45 * u) * open * s;
    geo.ring(S.x + (G.x - S.x) * u, S.y + rr, S.z + (G.z - S.z) * u, d.x, d.z, rr, key, A * (0.2 + 0.3 * u), 12);
  }
  const far = { x: G.x + d.x * 0.9 * s, y: fl.y, z: G.z + d.z * 0.9 * s };
  geo.circle(far.x, far.y, far.z, 0.9 * s * open, key, A * 0.6, 18); // 호스트 표지(바닥 원 + 점)
  geo.circle(far.x, far.y, far.z, 0.5 * s * open, key, A * 0.35, 12);
  geo.quad(far.x, far.y + 0.45 * s, far.z, 0.5 * s * open, key, A * 0.9);
  if (open > 0.6) geo.label(far.x, far.y + 1.0 * s, far.z, ix.host || tr('cards.ix.remote'), key, A * open, 'ix-host');
  if (te == null) {
    const pu = env.reduced ? 0.5 : (t % 1.4) / 0.7;
    const hi = { x: far.x, y: far.y + 0.45 * s, z: far.z };
    if (pu < 1) travel(geo, S, hi, pu, 'remote', A * 0.6, 0.18 * s, 0.4); else if (pu < 2) travel(geo, hi, S, pu - 1, 'remote', A * 0.45, 0.15 * s, 0.4);
    if (ix.transfer) {
      const m = ix.bytes || ix.size ? Math.min(10, Math.max(3, Math.round(Math.log2((ix.bytes || ix.size) / 1024 + 2)))) : 5;
      const up = ix.transfer === 'up';
      for (let k = 0; k < m; k++) { const u = ((t * 0.8 + k / m) % 1); travel(geo, up ? S : hi, up ? hi : S, u, up ? 'write' : 'read', A * 0.75, 0.16 * s, 0.1); }
    }
  }
}
function drawRemote(geo, f, ix, P, r, t, te, A, now, flow, env, lin = IXFX.LINGER.remote, fl = null) {
  const open = ease(t / 0.6) * (te == null ? 1 : 1 - ease(te / (lin * 0.9))); // F5 닫힘도 잔광에 맞춤(예전 0.9초 고정)
  if (open <= 0.01) return;
  if (fl) { drawRemoteFloor(geo, f, ix, P, r, t, te, A, now, env, open, fl); return; }
  const d = remoteDir(f, P, env);
  const L = r + 7.5;
  const G = { x: P.x + d.x * L, y: P.y + 1.2, z: P.z + d.z * L };
  const S = { x: P.x + d.x * r, y: P.y + 0.2, z: P.z + d.z * r };
  const key = te != null && f.ok === false ? 'err' : 'remote';
  if (flow) { // 터널(웜홀 게이트): 진행 방향을 따라 고리들
    for (let i = 1; i <= 5; i++) {
      const u = i / 5; if (u > open + 0.05) break;
      const c = { x: S.x + (G.x - S.x) * u, y: S.y + (G.y - S.y) * u, z: S.z + (G.z - S.z) * u };
      geo.ring(c.x, c.y, c.z, d.x, d.z, (0.25 + 0.4 * u) * open, key, A * (0.15 + 0.25 * u), 14);
    }
    geo.ring(G.x, G.y, G.z, d.x, d.z, 0.85 * open, key, A * 0.7, 20);
  } else { // Planet: 다른 항성계로 가는 점프 게이트(육각 틀) + 점선 항로
    for (let i = 0; i < 6; i++) {
      const a1 = (i / 6) * Math.PI * 2 + now * 0.6, a2 = ((i + 1) / 6) * Math.PI * 2 + now * 0.6, rr = 0.8 * open;
      const sx = -d.z, sz = d.x;
      geo.line(G.x + Math.cos(a1) * rr * sx, G.y + Math.sin(a1) * rr, G.z + Math.cos(a1) * rr * sz, G.x + Math.cos(a2) * rr * sx, G.y + Math.sin(a2) * rr, G.z + Math.cos(a2) * rr * sz, key, A * 0.7);
    }
    for (let i = 0; i < 12; i += 2) { const u1 = i / 12, u2 = (i + 1) / 12; if (u2 > open) break; geo.line(S.x + (G.x - S.x) * u1, S.y + (G.y - S.y) * u1, S.z + (G.z - S.z) * u1, S.x + (G.x - S.x) * u2, S.y + (G.y - S.y) * u2, S.z + (G.z - S.z) * u2, key, A * 0.3); }
  }
  // 끝의 원격 호스트 노드(별칭 라벨)
  const far = { x: G.x + d.x * 0.9, y: G.y, z: G.z + d.z * 0.9 };
  geo.quad(far.x, far.y, far.z, 0.3 * open, key, A * 0.85);
  if (open > 0.6) geo.label(far.x, far.y + 0.55, far.z, ix.host || tr('cards.ix.remote'), key, A * open, 'ix-host');
  // 주기적 핑, 파일 전송은 터널 속 패킷 흐름(크기 비례)
  if (te == null) {
    const pu = (t % 1.4) / 0.7;
    if (pu < 1) travel(geo, S, far, pu, 'remote', A * 0.55, 0.12, 0.2); else if (pu < 2) travel(geo, far, S, pu - 1, 'remote', A * 0.4, 0.1, 0.2);
    if (ix.transfer) {
      const m = ix.bytes || ix.size ? Math.min(10, Math.max(3, Math.round(Math.log2((ix.bytes || ix.size) / 1024 + 2)))) : 5;
      const up = ix.transfer === 'up';
      for (let k = 0; k < m; k++) { const u = ((t * 0.8 + k / m) % 1); travel(geo, up ? S : far, up ? far : S, u, up ? 'write' : 'read', A * 0.75, 0.13, 0.05); }
    }
  }
}

function gridCells(n) { const D = Math.max(1, Math.min(40, n)); const cols = Math.ceil(Math.sqrt(D * 2.2)); return { D, cols, rows: Math.ceil(D / cols) }; }
/** F3 흐름 3D batch: 발밑 무대 앞쪽 바닥 진행 띠(호, 한 줄 ROW 칸 · 최대 40칸) + i/N · n/s 라벨, 끝에 초록 섬광 */
function drawBatchFloor(geo, f, ix, t, te, A, env, fl, total, frac) {
  const B = IX_FLOOR.BATCH, D = Math.max(1, Math.min(40, total)), per = Math.min(D, B.ROW), rows = Math.ceil(D / per);
  const s = flScale(fl, per * (B.CS + B.GAP));
  const cs = B.CS * s, pitch = (B.CS + B.GAP) * s;
  const fold = te == null ? 0 : ease(te / 0.5);
  const lit = frac == null ? -1 : te != null && f.ok ? D : Math.floor(D * frac + 1e-6);
  const sweep = frac == null ? (env.reduced ? -1 : (t * 6) % D) : -1;
  const flash = te != null && f.ok ? clamp01(1 - Math.abs(te - 0.55) / 0.25) : 0;
  const a0 = (fl.ang || IX_FLOOR.ANG).batch;
  let endA = a0, endR = fl.R;
  for (let j = 0; j < D; j++) {
    const row = Math.floor(j / per), col = j % per;
    const rad = fl.R + 0.5 * s + cs / 2 + row * pitch * (1 - fold);
    const dA = Math.min(pitch / rad, (Math.PI * 1.4) / per);
    const a = a0 - (col - (per - 1) / 2) * dA; // 카메라(+z)에서 보아 왼쪽 → 오른쪽으로 채움
    const x = fl.x + Math.cos(a) * rad, z = fl.z + Math.sin(a) * rad;
    const on = j < lit || (sweep >= 0 && Math.abs(j - sweep) < 1.5);
    geo.quad(x, fl.y + cs * 0.5, z, cs, flash > 0 ? 'ok' : on ? 'batch' : 'dim', A * (on ? 0.85 : 0.22) * (1 - fold * 0.5) + flash * 0.5 * A);
    if (row === 0 && col === per - 1) { endA = a - dA; endR = rad; }
  }
  // 띠 테두리(안·바깥 호) — 칸이 흩어진 점이 아니라 한 장치로 읽히게
  const span = Math.min(pitch / (fl.R + 0.5 * s + cs / 2), (Math.PI * 1.4) / per) * (per / 2 + 0.3);
  for (const rr of [fl.R + 0.5 * s - 0.08 * s, fl.R + 0.5 * s + cs + (rows - 1) * pitch * (1 - fold) + 0.08 * s]) geo.circle(fl.x, fl.y, fl.z, rr, te != null && f.ok ? 'ok' : 'batch', A * 0.3, 20, a0 - span, a0 + span);
  const rate = IxModel.rate(f);
  const lab = ix.op === 'streak' ? `${ix.tool || ''} ×${ix.i || 0}` : ix.n ? `${ix.i ?? 0}/${ix.n}${rate && rate > 0 && te == null ? ` · ${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/s` : ''}` : ix.pct != null ? `${ix.pct}%` : ix.par ? `×${ix.par}` : '';
  if (lab) geo.label(fl.x + Math.cos(endA) * endR, fl.y + 0.3, fl.z + Math.sin(endA) * endR, lab, te != null && f.ok ? 'ok' : 'batch', A * 0.9, 'ix-tick');
}
function drawBatch(geo, f, ix, P, r, t, te, A, now, flow, env, fl = null) {
  if (ix.op === 'fan' || ix.op === 'workflow') { // 부채꼴 파도
    const waves = ix.op === 'fan' ? f.pulses.concat([f.t0]).slice(-5) : [f.t0, f.t0 + 0.4, f.t0 + 0.8];
    for (const w0 of waves) {
      const q = (now - w0) / 1.3;
      if (q <= 0 || q >= 1) continue;
      const rr = r + 0.4 + q * 3.2;
      geo.circle(P.x, P.y, P.z, rr, 'batch', A * (1 - q) * 0.7, 18, Math.PI * 0.15, Math.PI * 0.85);
    }
    if (ix.i) geo.label(P.x, P.y - 0.2, P.z + r + 1.0, tr('cards.ix.fanBadge', { n: ix.i }), 'batch', A * 0.85, 'ix-tick');
    return;
  }
  const total = ix.n || (ix.op === 'streak' ? Math.max(12, (ix.i || 0) + 4) : 24);
  const frac = ix.n ? clamp01((ix.i || 0) / ix.n) : ix.pct != null ? clamp01(ix.pct / 100) : ix.op === 'streak' ? clamp01((ix.i || 0) / total) : null;
  if (fl) { drawBatchFloor(geo, f, ix, t, te, A, env, fl, total, frac); return; }
  const { D, cols, rows } = gridCells(total);
  const cs = 0.3, gap = 0.08, W = cols * (cs + gap);
  const fold = te == null ? 0 : ease(te / 0.5);
  const lit = frac == null ? -1 : te != null && f.ok ? D : Math.floor(D * frac + 1e-6);
  const sweep = frac == null ? (t * 6) % D : -1;
  for (let j = 0; j < D; j++) {
    const cx = j % cols, cy = Math.floor(j / cols);
    let x, y, z;
    if (flow) { x = P.x - W / 2 + cx * (cs + gap) + cs / 2; z = P.z + r + 1.1 + cy * (cs + gap) * (1 - fold); y = P.y; }
    else { const a = Math.PI * 0.25 + (j / D) * Math.PI * 0.5 + (t * 0.15) % (Math.PI * 0.5 / D); const br = r + 1.6 + cy * 0.0; x = P.x + Math.cos(a) * br; z = P.z + Math.sin(a) * br; y = P.y - 0.2; }
    const on = j < lit || (sweep >= 0 && Math.abs(j - sweep) < 1.5);
    const flash = te != null && f.ok ? clamp01(1 - Math.abs(te - 0.55) / 0.25) : 0;
    geo.quad(x, y, z, cs * (flow ? 1 : 0.6), flash > 0 ? 'ok' : on ? 'batch' : 'dim', A * (on ? 0.85 : 0.22) * (1 - fold * 0.5) + flash * 0.5 * A);
  }
  // 처리율 스파크라인
  const h = f.hist;
  if (flow && h.length >= 3 && te == null) {
    const rates = [];
    for (let i = 1; i < h.length; i++) { const dt = h[i][0] - h[i - 1][0]; rates.push(dt > 0 ? (h[i][1] - h[i - 1][1]) / dt : 0); }
    const mx = Math.max(...rates, 1e-6);
    const x0 = P.x - W / 2, y0 = P.y, z0 = P.z + r + 0.75;
    for (let i = 1; i < rates.length; i++) geo.line(x0 + ((i - 1) / (rates.length - 1)) * W, y0, z0 - (rates[i - 1] / mx) * 0.45, x0 + (i / (rates.length - 1)) * W, y0, z0 - (rates[i] / mx) * 0.45, 'batch', A * 0.7);
  }
  const rate = IxModel.rate(f);
  const lab = ix.op === 'streak' ? `${ix.tool || ''} ×${ix.i || 0}` : ix.n ? `${ix.i ?? 0}/${ix.n}${rate && rate > 0 && te == null ? ` · ${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/s` : ''}` : ix.pct != null ? `${ix.pct}%` : ix.par ? `×${ix.par}` : '';
  if (lab) geo.label(flow ? P.x + W / 2 + 0.6 : P.x, P.y, flow ? P.z + r + 1.2 : P.z + r + 2.2, lab, te != null && f.ok ? 'ok' : 'batch', A * 0.9, 'ix-tick');
}

/** F3 흐름 3D tests: 발밑 무대 왼쪽 뒤 바닥 점수판(≤64타일, 타일 0.55·간격 0.12) · 실패 타일 붉은 잔광 · 점수 배지 */
function drawTestsFloor(geo, f, ix, t, te, A, now, env, fl, T, pT, fT, sT, known, fail, pass) {
  const C0 = IX_FLOOR.TEST, cols = Math.ceil(Math.sqrt(T)), rowsN = Math.ceil(T / cols);
  const s = flScale(fl, cols * (C0.CS + C0.GAP));
  const cs = C0.CS * s, pitch = (C0.CS + C0.GAP) * s, W = cols * pitch, Dp = rowsN * pitch;
  const C = floorAt(fl, 'tests', fl.R + 0.4 * s + Math.hypot(W, Dp) / 2);
  const shake = te != null && fail && !env.reduced ? Math.max(0, 1 - te / 1.2) : 0;
  const x0 = C.x - W / 2, z0 = C.z - Dp / 2;
  for (let j = 0; j < T; j++) {
    const cx = j % cols, cy = Math.floor(j / cols);
    let key = 'dim', al = 0.2;
    if (j < pT) { key = 'ok'; al = 0.8; } else if (j < pT + fT) { key = 'err'; al = 0.95; } else if (j < pT + fT + sT) { key = 'skip'; al = 0.6; }
    if (te == null && ix.pass == null && j === (env.reduced ? -1 : Math.floor(t * 8) % T)) { key = 'tests'; al = 0.6; } // 아직 결과 없음: 훑기
    let x = x0 + cx * pitch + pitch / 2;
    const z = z0 + cy * pitch + pitch / 2;
    if (key === 'err' && shake) x += Math.sin(now * 38 + j) * 0.06 * s * shake;
    geo.quad(x, C.y + cs * 0.5, z, cs, key, A * al);
    if (key === 'err' && te != null) geo.quad(x, C.y + cs * 0.5 + 0.01, z, cs * 1.9, 'err', A * 0.18 * Math.max(0, 1 - te / 5)); // 붉은 잔광
  }
  // 판 테두리
  const k = te != null ? (fail ? 'err' : 'ok') : 'tests', m = 0.1 * s;
  geo.line(x0 - m, C.y, z0 - m, x0 + W + m, C.y, z0 - m, k, A * 0.35); geo.line(x0 + W + m, C.y, z0 - m, x0 + W + m, C.y, z0 + Dp + m, k, A * 0.35);
  geo.line(x0 + W + m, C.y, z0 + Dp + m, x0 - m, C.y, z0 + Dp + m, k, A * 0.35); geo.line(x0 - m, C.y, z0 + Dp + m, x0 - m, C.y, z0 - m, k, A * 0.35);
  if (te != null && !fail && pass && !env.reduced) { // 전부 통과: 짧은 축하 반짝임
    const q = te / 0.9;
    if (q < 1) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const rr = (0.6 + q * 2.2) * s; geo.quad(C.x + Math.cos(a) * rr, C.y + 0.3 + q * 0.6, C.z + Math.sin(a) * rr, 0.18 * s * (1 - q), 'ok', A * (1 - q)); }
  }
  if (te != null && known) geo.label(C.x, C.y + 0.3, z0 - m - 0.2, testScore(ix), fail ? 'err' : 'ok', A, 'ix-badge');
  else if (known) geo.label(C.x, C.y + 0.3, z0 - m - 0.2, testScore(ix) + ' …', 'tests', A * 0.8, 'ix-tick');
}
function drawTests(geo, f, ix, P, r, t, te, A, now, flow, env, fl = null) {
  const pass = ix.pass || 0, fail = ix.fail || 0, skip = ix.skip || 0;
  const known = pass + fail + skip;
  const total = Math.max(ix.total || 0, known);
  const T = total ? Math.min(64, total) : Math.min(64, Math.max(16, known + 4));
  const per = total > 64 ? total / 64 : 1;
  const pT = Math.round(pass / per), fT = fail ? Math.max(1, Math.round(fail / per)) : 0, sT = Math.round(skip / per);
  if (fl) { drawTestsFloor(geo, f, ix, t, te, A, now, env, fl, T, pT, fT, sT, known, fail, pass); return; }
  const cols = Math.ceil(Math.sqrt(T)), cs = 0.24, gap = 0.06, W = cols * (cs + gap);
  const shake = te != null && fail && !env.reduced ? Math.max(0, 1 - te / 1.2) : 0;
  for (let j = 0; j < T; j++) {
    const cx = j % cols, cy = Math.floor(j / cols);
    let key = 'dim', al = 0.2;
    if (j < pT) { key = 'ok'; al = 0.8; } else if (j < pT + fT) { key = 'err'; al = 0.95; } else if (j < pT + fT + sT) { key = 'skip'; al = 0.6; }
    if (te == null && ix.pass == null && j === Math.floor(t * 8) % T) { key = 'tests'; al = 0.6; } // 아직 결과 없음: 훑기
    let x, y, z;
    if (flow) { x = P.x - r - 0.9 - W + cx * (cs + gap) + cs / 2; z = P.z - (Math.ceil(T / cols) * (cs + gap)) / 2 + cy * (cs + gap); y = P.y; }
    else { const g = j * 2.39996, rr = r + 1.0 + 0.5 * Math.sqrt(j / T); x = P.x + Math.cos(g + now * 0.25) * rr; z = P.z + Math.sin(g + now * 0.25) * rr; y = P.y + ((j % 7) / 7 - 0.5) * r; }
    if (key === 'err' && shake) x += Math.sin(now * 38 + j) * 0.06 * shake;
    geo.quad(x, y, z, flow ? cs : 0.14, key, A * al);
    if (key === 'err' && te != null) geo.quad(x, y + 0.01, z, (flow ? cs : 0.14) * 1.9, 'err', A * 0.18 * Math.max(0, 1 - te / 5)); // 붉은 잔광
  }
  const cx = flow ? P.x - r - 0.9 - W / 2 : P.x, cz = P.z;
  if (te != null && !fail && pass && !env.reduced) { // 전부 통과: 짧은 축하 반짝임
    const q = te / 0.9;
    if (q < 1) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const rr = 0.4 + q * 1.6; geo.quad(cx + Math.cos(a) * rr, P.y + 0.3 + q * 0.5, cz + Math.sin(a) * rr, 0.12 * (1 - q), 'ok', A * (1 - q)); }
  }
  if (te != null && known) geo.label(cx, P.y + 0.4, cz - (flow ? W * 0.55 + 0.35 : r + 1.4), testScore(ix), fail ? 'err' : 'ok', A, 'ix-badge');
  else if (known) geo.label(cx, P.y + 0.4, cz - (flow ? W * 0.55 + 0.35 : r + 1.4), testScore(ix) + ' …', 'tests', A * 0.8, 'ix-tick');
}
