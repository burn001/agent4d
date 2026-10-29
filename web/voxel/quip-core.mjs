// 복셀 생각·말풍선 순수 규칙 — three·DOM 없음, node --test 대상. 3D(office.js)·2D(flat/voxel2d.js)가 같이 쓴다.
//   · 상황(situation) 판정: 이벤트(도구 시작·결과·특별 상호작용·사용자·충돌·메시지·등장·퇴장) → 말풍선(say),
//     캐릭터 상태(생각 중·대기·커피·감독·오래 도는 셸·막힘·컨텍스트·밤샘) → 생각 풍선(think).
//   · 대사 고르기: 캐릭터별·상황별 셔플 백(다 쓰기 전엔 같은 줄 안 나옴) + 전역 최근 N줄 회피 + 화면에 떠 있는 글 회피.
//     시드 = 노드 id + 상황 + 이벤트 시각(재생은 가상 시각) → 같은 재생이면 비슷한 흐름, 매번 똑같은 순서는 아님(라운드마다 섞음).
//   · 자리표시자({file} {cmd} …)는 서버가 redact 한 brief·ix 값만. privacy minimal 이면 서버가 글을 비우므로 숫자 말고는 채울 값이 없다.
//   · 빈도: 캐릭터당 최소 간격, 생각 풍선 주기, 전역 토큰 버킷, 고배속 솎기 — QuipDirector.

export const QUIP = {
  GAP: 5.5,            // 한 캐릭터의 풍선 사이 최소 간격(벽시계 초)
  GAP_URGENT: 2.2,     // 중요 이벤트(실패·사용자·충돌·테스트 결과)는 이만큼만 지나면 덮어씀
  THINK_MIN: 9, THINK_SPAN: 10, // 생각 풍선 주기: 9～19초(캐릭터마다 다름)
  THINK_FIRST: 3, THINK_FIRST_SPAN: 9,
  DUR_SAY: 3.1, DUR_THINK: 3.7,  // 표시 시간(초) — 배속이면 ÷√min(배속,4)
  RATE: 2.5, BURST: 4,  // 전역 새 풍선: 초당 2.5개, 한 번에 4개까지(300노드 폭주 막기)
  RECENT: 32,          // 전역 최근 줄(같은 줄 곧바로 다시 안 나옴)
  TPL_P: 0.3,          // 값이 있으면 이 확률로 자리표시자 줄을 먼저 찾음
  BAGS_MAX: 3000,      // 셔플 백 상한(오래된 것부터 버림)
  FAST: 8,             // 이 배속 이상이면 중요 이벤트·포커스만
  FASTER: 16,          // 이 배속 이상이면 포커스만
  LONG_THINK: 20,      // 도구 없이 이만큼 생각하면 think.long
  LONG_RUN: 15,        // 셸이 이만큼 열려 있으면 longrun
  WAIT_CHILD: 6,       // 팀장이 Agent·Workflow 도구를 이만큼 열어 두면 wait.child
  FAIL_WIN: 90, FAIL_N: 2, // 이 시간 안 실패 n번 → stuck
  MAX_ON: 6, MAX_ON_NARROW: 3, // 화면 동시 풍선
  LOD_PX: 9,           // 사람(반지름)이 화면에서 이보다 작으면 풍선 숨김(포커스·호버 제외)
};

/** 상황 키 전부(데이터 시험이 en·ko 모두 이 집합인지 본다) — kind: think(생각 풍선) | say(말풍선) */
export const SITUATIONS = {
  'think.lead': 'think', 'think.staff': 'think', 'think.op': 'think', 'think.guest': 'think', 'think.long': 'think',
  'idle.desk': 'think', 'idle.coffee': 'think', 'idle.stretch': 'think', 'idle.lead': 'think', 'wait.child': 'think',
  stuck: 'think', 'ctx.70': 'think', 'ctx.90': 'think', night: 'think', longrun: 'think', oversee: 'think',
  'tool.shell': 'say', 'tool.read': 'say', 'tool.edit': 'say', 'tool.write': 'say', 'tool.search': 'say', 'tool.web': 'say',
  'tool.agent': 'say', 'tool.workflow': 'say', 'tool.skill': 'say', 'tool.mcp': 'say', 'tool.monitor': 'say', 'tool.notify': 'say',
  'tool.artifact': 'say', 'tool.other': 'say', 'tool.ok': 'say', 'tool.fail': 'say', 'talk.lead': 'say', 'talk.staff': 'say',
  'git.push': 'say', 'git.pushRejected': 'say', 'git.pull': 'say', 'git.commit': 'say', 'git.merge': 'say', 'git.pr': 'say',
  'git.ci': 'say', 'git.ciPass': 'say', 'git.ciFail': 'say', 'db.read': 'say', 'db.write': 'say',
  'remote.ssh': 'say', 'remote.transfer': 'say', 'remote.fail': 'say', 'batch.run': 'say', 'batch.done': 'say',
  'tests.run': 'say', 'tests.pass': 'say', 'tests.fail': 'say',
  'user.prompt': 'say', 'user.midturn': 'say', 'user.interrupt': 'say', 'user.deny': 'say', 'user.ask': 'say',
  'user.answer': 'say', 'user.reply': 'say', 'user.command': 'say', conflict: 'say',
  'enter.staff': 'say', 'enter.op': 'say', 'enter.guest': 'say', 'leave.done': 'say', 'leave.error': 'say', 'leave.stopped': 'say',
  'done.lead': 'say', 'done.staff': 'say', 'done.op': 'say', 'fail.result': 'say', 'msg.peer': 'say',
};
/** 자주 나오는 상황(데이터 시험: 언어마다 40줄 이상) */
export const FREQUENT = ['think.lead', 'think.staff', 'idle.desk', 'tool.shell', 'tool.read', 'tool.edit'];
/** 상황마다 쓸 수 있는 자리표시자(데이터 시험이 확인) */
export const PLACEHOLDERS = {
  'tool.shell': ['cmd'], 'tool.read': ['file'], 'tool.edit': ['file'], 'tool.write': ['file'], 'tool.search': ['q'],
  'git.push': ['commits', 'branch'], 'git.pull': ['branch'], 'db.read': ['engine', 'n'], 'db.write': ['engine', 'n'],
  'remote.ssh': ['host'], 'remote.transfer': ['host'], 'batch.run': ['n'], 'batch.done': ['n'],
  'tests.pass': ['pass'], 'tests.fail': ['fail', 'pass'],
};
/** 중요도: 2 = 중요(간격 짧게 덮어씀·고배속에도), 1 = 보통, 0 = 생각·잡담 */
const URGENT = new Set(['tool.fail', 'git.pushRejected', 'git.ciFail', 'git.ciPass', 'remote.fail', 'tests.pass', 'tests.fail',
  'user.prompt', 'user.midturn', 'user.interrupt', 'user.deny', 'user.ask', 'user.answer', 'user.reply', 'user.command',
  'conflict', 'leave.error', 'fail.result', 'done.lead', 'git.push']);
export const priOf = (key) => (URGENT.has(key) ? 2 : SITUATIONS[key] === 'think' ? 0 : 1);

// ---------------- 결정적 난수 ----------------
export function hashStr(s) {
  let h = 2166136261;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- 자리표시자 ----------------
const PH_RE = /\{(\w+)\}/g;
export const placeholdersOf = (line) => { const out = []; for (const m of String(line).matchAll(PH_RE)) out.push(m[1]); return out; };
const PH_MAX = { file: 18, cmd: 12, q: 14, host: 14, branch: 14, engine: 10 };
const cutv = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** 값 채우기. 값이 하나라도 없으면 null */
export function fillLine(line, vals) {
  let ok = true;
  const out = String(line).replace(PH_RE, (_, k) => {
    const v = vals && vals[k];
    if (v == null || v === '') { ok = false; return ''; }
    return typeof v === 'number' ? v.toLocaleString('en-US') : cutv(String(v), PH_MAX[k] || 14);
  });
  return ok ? out : null;
}

const masked = (s) => !s || /\*{3}|<redacted|\[redacted/i.test(s);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** brief 에서 파일 이름(마지막 경로 조각): 'web/app.js' · 'app.js +3 −1' · 'x.md 12줄' */
export function fileOfBrief(brief) {
  const b = clean(brief);
  if (!b || masked(b)) return null;
  const tok = b.split(' ')[0].replace(/^["']|["']$/g, '');
  const base = tok.split(/[\\/]/).filter(Boolean).pop() || '';
  return /^[\w.\-@+~가-힣]{1,40}$/.test(base) && /[\w가-힣]/.test(base) ? base : null;
}
/** brief 에서 명령 첫 낱말: 'npm test' → npm, 'C:\x\python.exe -m y' → python */
export function cmdOfBrief(brief) {
  const b = clean(brief);
  if (!b || masked(b)) return null;
  let w = b.split(' ')[0].replace(/^["'&(]+|["')]+$/g, '');
  w = (w.split(/[\\/]/).pop() || '').replace(/\.(exe|cmd|bat|ps1|sh)$/i, '');
  if (/^[A-Z_][A-Z0-9_]*=/.test(w)) return null; // VAR=… 앞붙이
  return /^[\w.\-]{1,20}$/.test(w) && /[a-z]/i.test(w) ? w : null;
}
/** Grep '"pattern" · path' · Glob 'src/**' → 찾는 글 */
export function queryOfBrief(brief) {
  const b = clean(brief);
  if (!b || masked(b)) return null;
  const m = /^"([^"]{1,40})"/.exec(b);
  const q = m ? m[1] : b.split(' · ')[0];
  return q && q.length <= 40 ? q : null;
}

/** 이벤트 → 자리표시자 값(서버가 이미 redact·minimal 처리한 brief·ix 만) */
export function valsOf(ev) {
  const v = {};
  const ix = ev && ev.ix;
  if (ev && ev.type === 'tool-start') {
    const c = ev.cat;
    if (c === 'read' || c === 'edit' || c === 'write') { const f = fileOfBrief(ev.brief); if (f) v.file = f; }
    else if (c === 'shell') { const m = cmdOfBrief(ev.brief); if (m) v.cmd = m; }
    else if (c === 'search') { const q = queryOfBrief(ev.brief); if (q) v.q = q; }
  }
  if (ix && typeof ix === 'object') {
    const str = (s) => (typeof s === 'string' && s && !masked(s) ? s : null);
    const num = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n) : null);
    if (str(ix.branch)) v.branch = ix.branch;
    if (str(ix.host)) v.host = ix.host;
    if (str(ix.engine)) v.engine = ix.engine;
    if (num(ix.commits) > 0) v.commits = num(ix.commits);
    if (num(ix.pass) != null) v.pass = num(ix.pass);
    if (num(ix.fail) != null) v.fail = num(ix.fail);
    const n = num(ix.rows) ?? num(ix.n) ?? num(ix.total);
    if (n != null && n > 0) v.n = n;
  }
  return v;
}

// ---------------- 역할 ----------------
/** office-core roleOf 결과 → 대사 역할: lead · staff · op · guest */
export function quipRole(role) {
  if (role === 'lead') return 'lead';
  if (role === 'operator') return 'op';
  if (role === 'guest' || role === 'annex') return 'guest';
  return 'staff';
}

// ---------------- 이벤트 → 상황 ----------------
const GH = { push: 'git.push', pull: 'git.pull', fetch: 'git.pull', clone: 'git.pull', commit: 'git.commit', merge: 'git.merge', rebase: 'git.merge',
  'pr-merge': 'git.merge', 'pr-create': 'git.pr', 'pr-checks': 'git.ci', run: 'git.ci' };
const TOOL_CATS = new Set(['shell', 'read', 'write', 'edit', 'search', 'web', 'agent', 'workflow', 'skill', 'mcp', 'monitor', 'notify', 'artifact', 'other']);

/**
 * 이벤트 하나 → 말풍선 상황. who = {role('lead'|'staff'|'op'|'guest')}, r = 0..1 난수(확률 거르기).
 * @returns {{id:string, key:string}|null}  id = 말할 캐릭터(노드) id
 */
export function situationOf(ev, who, r = 0) {
  if (!ev || !ev.type) return null;
  const ix = ev.ix && typeof ev.ix === 'object' ? ev.ix : null;
  const role = (who && who.role) || 'staff';
  const id = ev.nodeId;
  switch (ev.type) {
    case 'tool-start': {
      if (ix) {
        if (ix.cat === 'user' && ix.op === 'ask') return { id, key: 'user.ask' };
        if (ix.cat === 'github' && GH[ix.op]) return { id, key: GH[ix.op] };
        if (ix.cat === 'db') return { id, key: ix.rw === 'r' ? 'db.read' : 'db.write' };
        if (ix.cat === 'remote') return { id, key: /^(scp|rsync|sftp)$/.test(ix.op) || ix.transfer ? 'remote.transfer' : 'remote.ssh' };
        if (ix.cat === 'tests') return { id, key: 'tests.run' };
        if (ix.cat === 'batch' && ix.phase !== 'progress') return r < 0.8 ? { id, key: 'batch.run' } : null;
      }
      const c = TOOL_CATS.has(ev.cat) ? ev.cat : 'other';
      // 도구마다 말하면 시끄럽다: 팀장·자주 쓰는 도구는 덜
      const p = c === 'agent' || c === 'workflow' || c === 'skill' || c === 'notify' || c === 'artifact' ? 0.9 : role === 'lead' ? 0.45 : 0.6;
      return r < p ? { id, key: 'tool.' + c } : null;
    }
    case 'tool-end': {
      if (ix) {
        if (ix.cat === 'user' && ix.op === 'deny') return { id, key: 'user.deny' };
        if (ix.cat === 'user' && ix.op === 'ask') return ix.declined || ev.ok === false ? { id, key: 'user.deny' } : { id, key: 'user.answer' };
        if (ix.cat === 'github' && (ix.rejected || (ix.op === 'push' && ev.ok === false))) return { id, key: 'git.pushRejected' };
        if (ix.cat === 'github' && ix.ci && typeof ix.ci === 'object') {
          if ((ix.ci.fail | 0) > 0) return { id, key: 'git.ciFail' };
          if ((ix.ci.pending | 0) === 0 && (ix.ci.pass | 0) > 0) return { id, key: 'git.ciPass' };
        }
        if (ix.cat === 'remote' && (ix.connFail || ev.ok === false)) return { id, key: 'remote.fail' };
        if (ix.cat === 'tests' && ix.phase !== 'progress') {
          if ((ix.fail | 0) > 0 || ev.ok === false) return { id, key: 'tests.fail' };
          if ((ix.pass | 0) > 0) return { id, key: 'tests.pass' };
        }
        if (ix.cat === 'batch' && ix.phase === 'end' && ev.ok !== false) return { id, key: 'batch.done' };
      }
      if (ev.ok === false && !ev.stopped) return r < 0.75 ? { id, key: 'tool.fail' } : null;
      return r < 0.12 ? { id, key: 'tool.ok' } : null;
    }
    case 'output':
      if (ix && ix.cat === 'tests' && ix.phase === 'end') return (ix.fail | 0) > 0 ? { id, key: 'tests.fail' } : (ix.pass | 0) > 0 ? { id, key: 'tests.pass' } : null;
      if (ix && ix.cat === 'batch' && ix.phase === 'end') return { id, key: 'batch.done' };
      return null;
    case 'user': {
      if (ev.origin !== 'human') return null;
      const op = ix && ix.cat === 'user' ? ix.op : 'prompt';
      const key = { prompt: 'user.prompt', midturn: 'user.midturn', command: 'user.command', interrupt: 'user.interrupt', deny: 'user.deny' }[op];
      return key ? { id, key } : null;
    }
    case 'node-update':
      if (ix && ix.cat === 'user' && ix.op === 'reply') return { id, key: 'user.reply' };
      return null;
    case 'text':
      if (ev.role !== 'assistant') return null;
      return r < 0.35 ? { id, key: role === 'lead' ? 'talk.lead' : 'talk.staff' } : null;
    case 'result':
      if (ev.ok === false) return { id, key: 'fail.result' };
      return { id, key: role === 'lead' || role === 'guest' ? 'done.lead' : role === 'op' ? 'done.op' : 'done.staff' };
    case 'conflict':
      if (ev.state === 'off') return null;
      return { id: ev.nodeA || ev.nodeId, key: 'conflict', also: ev.nodeB || ev.peer || null };
    case 'session-msg':
      return { id: ev.fromNode || ev.nodeId, key: 'msg.peer' };
    default: return null;
  }
}

/** 등장·퇴장 상황(뷰가 캐릭터 상태 전이에서 부름) */
export function enterKey(role) { return role === 'op' ? 'enter.op' : role === 'guest' ? 'enter.guest' : role === 'lead' ? null : 'enter.staff'; }
export function leaveKey(status) { return status === 'error' ? 'leave.error' : status === 'stopped' ? 'leave.stopped' : 'leave.done'; }

/**
 * 캐릭터 상태 → 생각 풍선 상황(없으면 null). s = {role, state, status, onBreak, oversee, stretch, toolCat, toolAge, thinkFor,
 * fails(최근 실패 수), ctxPct, hour(가상 시각의 지역 시), atDesk}
 */
export function thoughtOf(s, r = 0) {
  if (!s) return null;
  if (s.state === 'leave' || s.state === 'gone' || s.state === 'enter' || s.state === 'blink') return null;
  if (s.onBreak) return s.state === 'walk' ? null : 'idle.coffee';
  if (s.state === 'walk') return null;
  if (s.fails >= QUIP.FAIL_N) return 'stuck';
  const ctx = Number(s.ctxPct) || 0;
  if (ctx >= 90 && r < 0.5) return 'ctx.90';
  if (ctx >= 70 && r < 0.35) return 'ctx.70';
  if (s.hour != null && s.hour >= 0 && s.hour < 5 && r > 0.75) return 'night';
  if (s.oversee) return 'oversee';
  if (s.toolCat) {
    if (s.toolCat === 'shell' && s.toolAge >= QUIP.LONG_RUN) return 'longrun';
    if (s.role === 'lead' && (s.toolCat === 'agent' || s.toolCat === 'workflow') && s.toolAge >= QUIP.WAIT_CHILD) return 'wait.child';
    return null; // 일하는 중: 말풍선은 이벤트가 맡는다
  }
  if (s.status === 'idle' || s.status === 'done') {
    if (s.role === 'lead') return 'idle.lead';
    return s.stretch ? 'idle.stretch' : 'idle.desk';
  }
  if (s.status !== 'active') return null;
  if (s.thinkFor >= QUIP.LONG_THINK && r < 0.6) return 'think.long';
  return 'think.' + (s.role === 'op' ? 'op' : s.role === 'guest' ? 'guest' : s.role === 'lead' ? 'lead' : 'staff');
}

// ---------------- 대사 고르기 ----------------
/**
 * 셔플 백 + 전역 최근 회피. lines = {상황: [줄…]}
 *   pick(who, key, {vals, seed, avoid}) → 채운 문자열 | null
 */
export class QuipPicker {
  constructor(lines = {}, { recent = QUIP.RECENT, bagsMax = QUIP.BAGS_MAX, tplP = QUIP.TPL_P } = {}) {
    this.lines = lines;
    this.bags = new Map();      // who|key → {order, pos, round, seed}
    this.recentN = recent;
    this.recent = [];           // 'key#idx' 고리
    this.recentSet = new Set();
    this.bagsMax = bagsMax;
    this.tplP = tplP;
  }
  setLines(lines) { this.lines = lines || {}; this.bags.clear(); this.recent.length = 0; this.recentSet.clear(); }
  has(key) { const a = this.lines[key]; return !!(a && a.length); }

  _bag(who, key, n, seed) {
    const k = who + '|' + key;
    let b = this.bags.get(k);
    if (!b || b.order.length !== n) {
      b = { order: null, pos: 0, round: 0, seed: (hashStr(k) ^ (seed >>> 0)) >>> 0 };
      b.order = shuffled(n, rng(b.seed));
      if (this.bags.size >= this.bagsMax) this.bags.delete(this.bags.keys().next().value);
      this.bags.set(k, b);
    }
    return b;
  }
  _next(b, n) {
    if (b.pos >= n) {
      const last = b.order[n - 1];
      b.round++;
      b.order = shuffled(n, rng((b.seed + Math.imul(b.round, 0x9e3779b1)) >>> 0));
      if (n > 1 && b.order[0] === last) { const j = 1 + (b.round % (n - 1)); [b.order[0], b.order[j]] = [b.order[j], b.order[0]]; }
      b.pos = 0;
    }
    return b.order[b.pos++];
  }
  _remember(key, i) {
    const t = key + '#' + i;
    this.recent.push(t); this.recentSet.add(t);
    while (this.recent.length > this.recentN) this.recentSet.delete(this.recent.shift());
  }

  pick(who, key, { vals = null, seed = 0, avoid = null, r = 0.5 } = {}) {
    const arr = this.lines[key];
    if (!arr || !arr.length) return null;
    const n = arr.length;
    const b = this._bag(who, key, n, seed);
    const hasVals = vals && Object.keys(vals).length > 0;
    // 가끔 실제 정보: 남은 백에서 값이 다 있는 자리표시자 줄을 앞으로 당긴다
    if (hasVals && r < this.tplP) {
      if (b.pos >= n) this._next(b, n), b.pos--;
      for (let j = b.pos; j < n; j++) {
        const i = b.order[j];
        if (!arr[i].includes('{') || this.recentSet.has(key + '#' + i)) continue;
        const s = fillLine(arr[i], vals);
        if (s == null || (avoid && avoid.has(s))) continue;
        [b.order[b.pos], b.order[j]] = [b.order[j], b.order[b.pos]];
        b.pos++;
        this._remember(key, i);
        return s;
      }
    }
    let fallback = null, fi = -1;
    for (let tries = 0; tries < 2 * n; tries++) { // 이번 바퀴 남은 줄이 모두 최근이면 다음 바퀴로
      const i = this._next(b, n);
      const line = arr[i];
      const s = line.includes('{') ? fillLine(line, vals) : line;
      if (s == null) continue;
      if (this.recentSet.has(key + '#' + i) || (avoid && avoid.has(s))) { if (fallback == null && !(avoid && avoid.has(s))) { fallback = s; fi = i; } continue; }
      this._remember(key, i);
      return s;
    }
    if (fallback != null) { this._remember(key, fi); return fallback; }
    return null;
  }
}

function shuffled(n, rand) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// ---------------- 빈도 ----------------
/**
 * 언제 띄울지(순수, 시계는 부르는 쪽이 줌). 캐릭터별 마지막 풍선 시각·다음 생각 시각·최근 실패,
 * 전역 토큰 버킷. speed = 재생 배속(라이브 1).
 */
export class QuipDirector {
  constructor({ quip = QUIP } = {}) {
    this.q = quip;
    this.st = new Map();   // id → {last, lastPri, nextThink, fails:[t], thinkFrom}
    this.tokens = quip.BURST; this.tAt = null;
  }
  _s(id, now) {
    let s = this.st.get(id);
    if (!s) {
      const h = hashStr(id);
      s = { last: -1e9, lastPri: 0, nextThink: now + this.q.THINK_FIRST + (h % 1000) / 1000 * this.q.THINK_FIRST_SPAN, fails: [], thinkFrom: now, h };
      this.st.set(id, s);
    }
    return s;
  }
  drop(id) { this.st.delete(id); }
  clear() { this.st.clear(); this.tokens = this.q.BURST; this.tAt = null; }
  _refill(now) {
    if (this.tAt == null) this.tAt = now;
    this.tokens = Math.min(this.q.BURST, this.tokens + (now - this.tAt) * this.q.RATE);
    this.tAt = now;
  }
  /** 실패 기록(stuck 판정용) */
  noteFail(id, now) { const s = this._s(id, now); s.fails.push(now); while (s.fails.length > 6) s.fails.shift(); }
  fails(id, now) { const s = this.st.get(id); if (!s) return 0; let n = 0; for (const t of s.fails) if (now - t <= this.q.FAIL_WIN) n++; return n; }
  /** 도구가 열리거나 닫히면 생각 시작 시각을 새로 */
  noteBusy(id, now) { const s = this._s(id, now); s.thinkFrom = now; }
  thinkFor(id, now) { const s = this.st.get(id); return s ? now - s.thinkFrom : 0; }

  /** 이 캐릭터가 지금 말풍선을 띄워도 되나(우선순위 pri). focus = 포커스·호버 */
  allow(id, now, pri, { speed = 1, focus = false } = {}) {
    if (speed >= this.q.FASTER && !focus) return false;
    if (speed >= this.q.FAST && !focus && pri < 2) return false;
    const s = this._s(id, now);
    const gap = pri >= 2 ? this.q.GAP_URGENT : this.q.GAP;
    if (now - s.last < gap && !(pri > s.lastPri && now - s.last >= this.q.GAP_URGENT)) return false;
    this._refill(now);
    if (this.tokens < 1 && !(focus && pri >= 1)) return false;
    return true;
  }
  /** 띄움 확정 */
  commit(id, now, pri, kind) {
    const s = this._s(id, now);
    s.last = now; s.lastPri = pri;
    this.tokens = Math.max(0, this.tokens - 1);
    // 말한 뒤 생각은 조금 미룬다(말풍선과 생각 풍선이 붙어 나오지 않게)
    const span = this.q.THINK_MIN + ((s.h >>> 8) % 1000) / 1000 * this.q.THINK_SPAN;
    s.nextThink = Math.max(s.nextThink, now + (kind === 'think' ? span : span * 0.6));
  }
  /** 생각 풍선 차례인가 */
  thinkDue(id, now) { const s = this._s(id, now); return now >= s.nextThink; }
  /** 생각할 게 없었으면 조금 뒤 다시 본다 */
  thinkLater(id, now, sec = 2.5) { const s = this._s(id, now); s.nextThink = now + sec; }
}

/** 표시 시간(초) */
export function quipDur(kind, speed = 1) {
  const base = kind === 'think' ? QUIP.DUR_THINK : QUIP.DUR_SAY;
  return base / Math.sqrt(Math.min(Math.max(speed || 1, 1), 4));
}

/**
 * 화면 동시 풍선 고르기(순수): 후보 [{id, pri, born, dist(카메라 거리 또는 화면 비율 역수), focus, active}] → 남길 순서.
 * 포커스 > 중요도 > 가까움 > 활동 중 > 최근
 */
export function rankQuips(list) {
  return list.sort((a, b) => (b.focus - a.focus) || (b.pri - a.pri) || (a.dist - b.dist) || ((b.active ? 1 : 0) - (a.active ? 1 : 0)) || (b.born - a.born));
}
