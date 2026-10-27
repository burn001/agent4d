// 세션 재생: 오프라인 재구성·후처리·캐시·타임라인·페이지·스냅샷
// 재생 데이터는 메모리에만 둔다(디스크에 사본을 남기지 않음).
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as nextTick } from 'node:timers/promises';
import { RootRuntime, fgHoldMs } from './session.mjs';
import { redact } from './redact.mjs';
// 하이라이트: 웹과 같은 순수 함수(서버·mock 재생이 같은 정의)
import { computeHighlights } from '../web/replay/highlights.mjs';
import { t } from './cli-i18n.mjs';

export const KEYFRAME_EVERY = 1000;
export const PAGE_DEFAULT = 2000;
export const PAGE_MAX = 5000;
export const RECENT_MAX = 300;
const IDLE_MS = 60_000;
const GAP_MS = 60_000;
const OUTPUT_PIECE = 600;
const OUTPUT_PIECES_MAX = 60;
const PROC_PIECE = 0, PROC_PIECES_MAX = 400; // 분리 프로세스 로그: 한 줄씩(줄이 많으면 400 조각으로 고르게 묶음)
const SESSION_KINDS = new Set(['main', 'claude-p']);
const RANK = { 'node-add': 0, 'node-update': 1, 'tool-start': 2, 'tool-end': 4 };
const rankOf = (type) => RANK[type] ?? 3;
const iso = (ms) => new Date(ms).toISOString();

// ───────────── 상태 reducer (app.js onEvent 의 store 갱신과 같은 의미) ─────────────

function cloneNode(n) {
  return {
    ...n,
    meta: { ...(n.meta || {}) },
    counts: n.counts ? { ...n.counts } : n.counts,
    openTools: (n.openTools || []).map((t) => ({ ...t })),
  };
}

export function createState() { return { nodes: new Map(), root: null, seq: 0 }; }

export function cloneState(st) {
  const nodes = new Map();
  for (const [id, n] of st.nodes) nodes.set(id, cloneNode(n));
  return { nodes, root: st.root, seq: st.seq };
}

export function applyEvent(st, ev) {
  if (!ev || !ev.type) return st;
  if (typeof ev.seq === 'number') st.seq = ev.seq;
  const n = st.nodes.get(ev.nodeId);
  switch (ev.type) {
    case 'node-add': {
      const node = ev.node;
      if (!node) break;
      const prev = st.nodes.get(node.id);
      if (prev) Object.assign(prev, cloneNode(node));
      else {
        const c = cloneNode(node);
        st.nodes.set(c.id, c);
        if (!st.root && (c.kind === 'main' || !c.parentId)) st.root = c.id;
      }
      break;
    }
    case 'node-update': {
      if (!n) break;
      const { meta, ...rest } = ev.patch || {};
      Object.assign(n, rest);
      if (meta) n.meta = { ...(n.meta || {}), ...meta };
      break;
    }
    case 'tool-start':
      if (n) {
        n.openTools = n.openTools || [];
        if (!n.openTools.some((t) => t.toolUseId === ev.toolUseId)) {
          n.openTools.push({ toolUseId: ev.toolUseId, tool: ev.tool, cat: ev.cat, skill: ev.skill, startedAt: ev.ts, text: ev.text });
        }
      }
      break;
    case 'tool-end':
      if (n) n.openTools = (n.openTools || []).filter((t) => t.toolUseId !== ev.toolUseId);
      break;
    default:
      break;
  }
  if (n && ev.ts) n.lastActivityAt = ev.ts;
  return st;
}

export function toSnapshot(st, recent = [], sessionId = null) {
  return { root: st.root, sessionId, seq: st.seq, nodes: [...st.nodes.values()].map(cloneNode), recent };
}

// ───────────── 정렬·조립 (공통: 실제·데모) ─────────────

/** items: [{e, t, o}] → 정렬 후 이벤트 배열(t·rseq·seq·synth 부여) */
function sortAndNumber(items) {
  items.sort((a, b) => a.t - b.t || rankOf(a.e.type) - rankOf(b.e.type) || a.o - b.o);
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const { e, t, moved } = items[i];
    if (moved || !e.ts || Date.parse(e.ts) !== t) e.ts = iso(t);
    e.t = t;
    e.rseq = i + 1;
    e.seq = i + 1;
    if (e.synth) e.synth = true; else delete e.synth;
    out[i] = e;
  }
  return out;
}

/** 정렬된 이벤트 → keyframe·nodeIndex·최종 상태 */
async function assemble({ sessionId, title, events, startT, endT, complete, extra = {} }) {
  const st = createState();
  const keyframes = [{ rseq: 0, t: startT, root: null, nodes: [] }];
  const addT = new Map();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    applyEvent(st, ev);
    if (ev.type === 'node-add' && ev.node && !addT.has(ev.node.id)) addT.set(ev.node.id, ev.t);
    if ((i + 1) % KEYFRAME_EVERY === 0) {
      keyframes.push({ rseq: i + 1, t: ev.t, root: st.root, nodes: [...st.nodes.values()].map(cloneNode) });
    }
    if ((i & 8191) === 8191) await nextTick();
  }
  const nodeIndex = [...st.nodes.values()].map((n) => ({
    id: n.id, kind: n.kind, label: n.label, parentId: n.parentId ?? null, depth: n.depth ?? 0,
    startTs: addT.has(n.id) ? iso(addT.get(n.id)) : n.startedAt ?? null, endTs: n.endedAt ?? null,
  }));
  const root = st.root;
  const lastT = events.length ? events[events.length - 1].t : startT;
  const endMs = Math.max(endT ?? lastT, lastT, startT);
  return {
    sessionId, root, title: redact(title || (root && st.nodes.get(root)?.label) || sessionId),
    startTs: iso(startT), endTs: iso(endMs),
    events, keyframes, nodeIndex,
    stats: { eventCount: events.length, nodeCount: st.nodes.size, ...(extra.stats || {}) },
    complete: !!complete,
    builtAt: new Date().toISOString(),
    finalState: st,
    ...extra.fields,
  };
}

// ───────────── 오프라인 재구성 후처리 (normalize) ─────────────

/**
 * rt: loadOffline() 끝난 RootRuntime. 반환: 정렬·번호까지 끝난 이벤트 배열과 범위.
 * 단계: 1 node-add 시각 보정 → 4 출력 배분 → 2 범위 밖 시각 고정 → 3 인과 순서 → 5 대기 합성 → 6 정렬·번호
 */
export async function normalize(rt, { now = Date.now() } = {}) {
  const g = rt.graph;
  const mainId = `s:${rt.sessionId}`;
  const ring = g.ring;
  const sweepFrom = rt.sweepFrom ?? ring.length;
  for (let i = sweepFrom; i < ring.length; i++) ring[i].synth = true; // offline sweep 이 만든 대기·만료
  const mainNode = g.get(mainId);
  const lo = Date.parse(mainNode?.startedAt) || Date.parse(ring[0]?.ts) || 0;
  const clockMs = Date.parse(rt._clockIso) || lo;
  const hi = Math.max(clockMs, lo) + 5000;
  const sessionEnd = Math.max(clockMs, lo);
  const inRange = (t) => Number.isFinite(t) && t >= lo && t <= hi;

  const items = ring.map((e, i) => ({ e, t: Date.parse(e.ts), o: i * 4, moved: false, sweep: i >= sweepFrom }));

  // ── 1. node-add 시각 보정 ──
  const addItem = new Map();
  const firstT = new Map();
  const lastT = new Map();
  for (const it of items) {
    const id = it.e.nodeId;
    if (it.e.type === 'node-add') { if (!addItem.has(id)) addItem.set(id, it); continue; }
    if (!inRange(it.t)) continue;
    if (!firstT.has(id) || it.t < firstT.get(id)) firstT.set(id, it.t);
    if (!lastT.has(id) || it.t > lastT.get(id)) lastT.set(id, it.t);
  }
  const spawnMemo = new Map();
  const spawnOf = (id, depth = 0) => {
    if (spawnMemo.has(id)) return spawnMemo.get(id);
    const node = g.get(id);
    const add = addItem.get(id);
    let t = NaN;
    if (id === mainId || !node) t = lo;
    else {
      // 기동기 회차: meta.toolUseId 는 기동 명령(회차마다 같음)이라 그 시각을 쓰면 회차가 모두 기동 시각에 한꺼번에 뜬다.
      // 회차는 제 첫 기록 시각(node-add 시각 = transcript 첫 기록)에 나온다
      const launcherCycle = node.kind === 'claude-p' && node.meta?.link?.by === 'launcher';
      const tu = node.meta?.toolUseId && !launcherCycle ? rt.tools.get(node.meta.toolUseId) : null;
      let cand = tu && inRange(tu.tsMs) ? tu.tsMs : NaN;
      if (launcherCycle && add && inRange(add.t)) cand = add.t;
      if (!Number.isFinite(cand)) { const h = Date.parse(rt.spawnHints.get(id)); if (inRange(h)) cand = h; }
      if (!Number.isFinite(cand) && node.kind === 'subagent' && rt.agentToolUse) {
        const tuid = rt.agentToolUse.get(id.slice(2));
        const tu2 = tuid ? rt.tools.get(tuid) : null;
        if (tu2 && inRange(tu2.tsMs)) cand = tu2.tsMs;
      }
      const f = firstT.get(id);
      if (Number.isFinite(cand)) t = Number.isFinite(f) ? Math.min(cand, f) : cand;
      else if (Number.isFinite(f)) t = f;
      else if (node.parentId && depth < 64) t = spawnOf(node.parentId, depth + 1);
      if (!Number.isFinite(t) && add && inRange(add.t)) t = add.t;
      if (!Number.isFinite(t)) t = lo;
    }
    t = Math.min(Math.max(t, lo), hi);
    spawnMemo.set(id, t);
    return t;
  };
  for (const [id, it] of addItem) {
    const t = spawnOf(id);
    const n = it.e.node;
    if (id !== mainId) {
      if (t !== it.t) it.moved = true;
      it.t = t;
      n.startedAt = iso(t);
      n.lastActivityAt = iso(t);
      n.status = 'active';
      n.endedAt = null;
      n.openTools = [];
    } else {
      it.t = lo;
      n.status = 'active';
      n.openTools = [];
      n.endedAt = null;
    }
  }

  // ── 4. 백그라운드 출력 배분 ──
  const hasOutputEv = new Set(items.filter((it) => it.e.type === 'output').map((it) => it.e.nodeId));
  let oSeq = ring.length * 4;
  for (const o of rt.outputs.values()) {
    const node = g.get(o.nodeId);
    if (!node || !o.chunks || !o.chunks.length) continue;
    if (node.kind === 'monitor' && hasOutputEv.has(o.nodeId)) continue; // 알림 <event> 가 진짜 시각을 가짐
    // `\r` 덮어쓰기(tqdm 등): 줄마다 `\r` 조각을 배분 단위로 펼친다 — 진행 인식은 조각마다, 패널은 그 줄의 지금 조각(라이브 LineTail 과 같은 모양)
    const rawLines = o.chunks.join('').split('\n');
    if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
    const lines = [], units = [];
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i].replace(/\r$/, '');
      const segs = l.includes('\r') ? l.split('\r').filter((x) => x) : [l];
      if (!segs.length) segs.push('');
      lines.push(segs[segs.length - 1]);
      segs.forEach((seg, k) => units.push({ text: seg, li: i, last: k === segs.length - 1 }));
    }
    if (!units.length) continue;
    const unitText = units.map((u) => u.text);
    // 분리 프로세스 로그는 진행 레인이 줄마다 움직이게 잘게(조각 수 상한도 넉넉히)
    const isProc = !!node.meta?.proc;
    const pieceMax = isProc ? PROC_PIECE : OUTPUT_PIECE, piecesMax = isProc ? PROC_PIECES_MAX : OUTPUT_PIECES_MAX;
    let pieces = [];
    let cur = '', curEnd = 0;
    for (let i = 0; i < units.length; i++) {
      const ln = units[i].text;
      if (cur && cur.length + 1 + ln.length > pieceMax) { pieces.push({ text: cur, end: curEnd }); cur = ''; }
      cur = cur ? `${cur}\n${ln}` : ln;
      curEnd = i + 1;
    }
    if (cur) pieces.push({ text: cur, end: curEnd });
    if (pieces.length > piecesMax) {
      const P = pieces.length, merged = [];
      for (let k = 0; k < piecesMax; k++) {
        const a = Math.floor((k * P) / piecesMax), b = Math.floor(((k + 1) * P) / piecesMax);
        const grp = pieces.slice(a, b);
        if (grp.length) merged.push({ text: grp.map((x) => x.text).join('\n'), end: grp[grp.length - 1].end });
      }
      pieces = merged;
    }
    const start = spawnOf(o.nodeId);
    let end = Date.parse(node.endedAt);
    if (!inRange(end)) {
      // 끝나지 않은 작업: 출력 파일을 마지막으로 쓴 시각까지만 배분(세션 끝까지 늘이면 라이브와 달리 계속 '작업 중')
      let mt = NaN;
      try { if (o.file) mt = fs.statSync(o.file).mtimeMs; } catch {}
      end = Number.isFinite(mt) && mt >= start ? Math.min(sessionEnd, mt) : sessionEnd;
    }
    if (end < start) end = start;
    const timeAt = lineTimer(unitText, isProc && rt.procAnchors ? rt.procAnchors(o.nodeId) : null, start, end);
    for (const p of pieces) {
      if (!p.text.trim()) continue;
      const t = timeAt(p.end);
      const u = units[p.end - 1];
      const panel = rt.replayOutputPanel ? rt.replayOutputPanel(o.nodeId, lines, u.li + 1, u.last ? null : u.text) : null; // 출력 꼬리(라이브와 같은 규칙)
      const ix = rt.outputIx ? rt.outputIx(o.nodeId, p.text + '\n') : null; // 진행(라이브와 같은 누적 규칙)
      const ev = g.emit({ ts: iso(t), type: 'output', nodeId: o.nodeId, text: p.text, synth: true, ...(panel ? { panel } : {}), ...(ix ? { ix } : {}) });
      items.push({ e: ev, t, o: (oSeq += 4), moved: false });
      // 작업 노드: 라이브 _flushOutput 과 같은 줄을 같은 순서로(조각 경계만 다를 수 있음)
      if (rt.jobFeed) {
        const r0 = ring.length;
        rt.jobFeed(o.nodeId, p.text + '\n', iso(t));
        for (let k = r0; k < ring.length; k++) { ring[k].synth = true; items.push({ e: ring[k], t, o: (oSeq += 4), moved: false }); }
      }
      // meta.run.lastOut(라이브와 같은 5초 솎기)
      if (rt.replayRunOut) {
        const r0 = ring.length;
        rt.replayRunOut(o.nodeId, t);
        for (let k = r0; k < ring.length; k++) { ring[k].synth = true; items.push({ e: ring[k], t, o: (oSeq += 4), moved: false }); }
      }
    }
    if (rt.replayRunEnd) {
      const r0 = ring.length;
      rt.replayRunEnd(o.nodeId);
      for (let k = r0; k < ring.length; k++) { ring[k].synth = true; items.push({ e: ring[k], t: Date.parse(ring[k].ts), o: (oSeq += 4), moved: false }); }
    }
    // 배분을 마친 스트림의 자동 진행 작업 마무리(노드가 끝났으면 끝, 아니면 솎아 낸 마지막 레인 값)
    if (rt.jobFeedEnd) {
      const r0 = ring.length;
      rt.jobFeedEnd(o.nodeId, iso(end));
      for (let k = r0; k < ring.length; k++) { ring[k].synth = true; items.push({ e: ring[k], t: end, o: (oSeq += 4), moved: false }); }
    }
  }
  await nextTick();

  // ── 2. 범위 밖 시각 고정 ──
  const prevValid = new Map();
  for (const it of items) {
    const id = it.e.nodeId;
    if (it.e.type === 'node-add') { prevValid.set(id, it.t); continue; }
    if (inRange(it.t)) { prevValid.set(id, it.t); continue; }
    // offline sweep 이 벽시계로 만든 만료(모니터 timeout)는 세션 끝 뒤라도 제 시각을 지킨다
    if (it.sweep && Number.isFinite(it.t) && it.t > hi && it.t <= now) continue;
    const terminal = it.e.type === 'result' || (it.e.type === 'node-update' && ['done', 'error', 'stopped'].includes(it.e.patch?.status));
    let t = terminal ? lastT.get(id) : undefined;
    if (!Number.isFinite(t)) t = prevValid.get(id);
    if (!Number.isFinite(t)) t = spawnOf(id);
    it.t = t; it.moved = true; it.e.synth = true;
  }

  // ── 3. 인과 순서 ──
  const addT = new Map([...addItem].map(([id, it]) => [id, it.t]));
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (const [id, it] of addItem) {
      const ps = [it.e.node.parentId, g.get(id)?.parentId].filter((p) => p && p !== id && addT.has(p));
      let t = it.t;
      for (const p of ps) t = Math.max(t, addT.get(p));
      if (t !== it.t) { it.t = t; it.moved = true; it.e.synth = true; it.e.node.startedAt = iso(t); it.e.node.lastActivityAt = iso(t); addT.set(id, t); changed = true; }
    }
    if (!changed) break;
  }
  const toolStartT = new Map();
  for (const it of items) {
    if (it.e.type === 'node-add') continue;
    let min = addT.get(it.e.nodeId);
    if (it.e.type === 'node-update' && it.e.patch?.parentId && addT.has(it.e.patch.parentId)) min = Math.max(min ?? -Infinity, addT.get(it.e.patch.parentId));
    if (Number.isFinite(min) && it.t < min) { it.t = min; it.moved = true; it.e.synth = true; }
    if (it.e.type === 'tool-start' && it.e.toolUseId && !toolStartT.has(it.e.toolUseId)) toolStartT.set(it.e.toolUseId, it.t);
  }
  for (const it of items) {
    if (it.e.type !== 'tool-end' || !it.e.toolUseId) continue;
    const s = toolStartT.get(it.e.toolUseId);
    if (Number.isFinite(s) && it.t < s) { it.t = s; it.moved = true; it.e.synth = true; }
  }
  await nextTick();

  // ── 5. 대기(idle) 합성 ──
  items.sort((a, b) => a.t - b.t || rankOf(a.e.type) - rankOf(b.e.type) || a.o - b.o);
  const per = new Map();
  for (const it of items) { const id = it.e.nodeId; if (!per.has(id)) per.set(id, []); per.get(id).push(it); }
  const childrenOf = new Map();
  for (const n of g.nodes.values()) if (n.parentId) { if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []); childrenOf.get(n.parentId).push(n.id); }
  const synthItems = [];
  const mkUpdate = (id, t, status, o) => {
    const ev = { seq: 0, ts: iso(t), type: 'node-update', nodeId: id, patch: { status }, synth: true };
    synthItems.push({ e: ev, t, o, moved: true });
  };
  for (const node of g.nodes.values()) {
    const id = node.id;
    if (node.meta?.job) continue; // 작업 노드 상태는 작업 상태가 정한다(대기 합성 없음 — 라이브 sweep 과 같음)
    // 분리 프로세스는 적응 정체 문턱(meta.proc.staleSec, 최소 60초)으로 대기 합성(라이브 _sweepProc 와 같은 생각)
    // 일반 bash-bg 는 출력 간격 적응 정체 문턱(meta.run.staleAfter, 최소 120초)
    const run = rt._runs?.get(id);
    const idleMs = node.meta?.proc ? Math.max(IDLE_MS, (Number(rt.procs?.get(id)?.staleSec ?? node.meta.procStaleSec) || 300) * 1000)
      : run && run.kind === 'bg' && !node.meta?.launcher && !node.meta?.runner ? Math.max(IDLE_MS, rt._runStaleMs(run)) : IDLE_MS;
    // 열린 포그라운드 셸(그 상한 = timeout + 1분)이 있는 동안은 대기로 떨어뜨리지 않는다(라이브 sweep 과 같음)
    const holds = new Map();
    const holdUntil = () => { let h = -Infinity; for (const v of holds.values()) if (v > h) h = v; return h; };
    let list = per.get(id) || [];
    if (node.kind === 'workflow') {
      const extra = (childrenOf.get(id) || []).flatMap((c) => per.get(c) || []);
      if (extra.length) list = [...list, ...extra].sort((a, b) => a.t - b.t || rankOf(a.e.type) - rankOf(b.e.type) || a.o - b.o);
    }
    let status = null, open = 0, pendingActive = false, last = null, lastO = 0;
    const isSession = SESSION_KINDS.has(node.kind);
    for (const it of list) {
      const own = it.e.nodeId === id;
      if (own && it.e.type === 'node-add') { status = it.e.node.status || 'active'; last = it.t; lastO = it.o; continue; }
      if (status == null) continue;
      if (last != null && status === 'active' && !(isSession && open > 0)) {
        const idleAt = Math.max(last + idleMs, holdUntil());
        if (it.t > idleAt) {
          mkUpdate(id, idleAt, 'idle', idleAt > last + idleMs ? it.o - 2 : lastO + 1);
          status = 'idle'; pendingActive = true;
        }
      }
      const isStatusUpdate = own && it.e.type === 'node-update' && it.e.patch && 'status' in it.e.patch;
      if (pendingActive && status === 'idle' && !isStatusUpdate) {
        mkUpdate(id, it.t, 'active', it.o - 1);
        status = 'active'; pendingActive = false;
      }
      if (own) {
        if (isStatusUpdate) {
          status = it.e.patch.status;
          pendingActive = status === 'idle' && !!it.e.synth;
        }
        if (it.e.type === 'tool-start') {
          open++;
          const tu = it.e.toolUseId ? rt.tools.get(it.e.toolUseId) : null;
          if (tu && (tu.name === 'Bash' || tu.name === 'PowerShell') && !tu.bg) holds.set(it.e.toolUseId, it.t + fgHoldMs(tu));
        } else if (it.e.type === 'tool-end') { open = Math.max(0, open - 1); holds.delete(it.e.toolUseId); }
      }
      last = it.t; lastO = it.o;
    }
    // 끝 구간: 라이브처럼 벽시계(빌드 시각) 기준으로 60초 넘게 조용하면 대기.
    // 지금 돌고 있는(busy) 세션 노드는 라이브도 active 로 두므로 건너뛴다.
    const tailRef = Math.max(sessionEnd, Number.isFinite(now) ? now : sessionEnd);
    const busy = isSession && node.sessionId && rt.index?.liveStatus?.(node.sessionId) === 'busy';
    // 끝 구간은 라이브 sweep 과 같은 규칙: 세션 노드는 프로세스가 busy 일 때만 active 유지. 닫히지 않은 도구(중단·강제 종료로
    // tool_result 가 없는 호출)가 남아 있어도 대기로 바꾼다(예전: open > 0 이면 영영 '작업 중'으로 남아 라이브 /state 와 달랐다).
    const tailIdle = last != null ? Math.max(last + idleMs, holdUntil()) : Infinity;
    if (status === 'active' && last != null && tailRef > tailIdle && !busy) {
      mkUpdate(id, tailIdle, 'idle', lastO + 1);
    }
  }
  for (const s of synthItems) items.push(s);
  await nextTick();

  // ── 6. 정렬·번호 ──
  const events = sortAndNumber(items);
  return { events, startT: lo, endT: Math.max(sessionEnd, events.length ? events[events.length - 1].t : lo) };
}

/** 최종 상태 검사: reducer 결과와 오프라인 그래프 최종 상태 비교. 불일치 목록 */
export function finalMismatches(finalState, graph) {
  const out = [];
  const act = (s) => (s === 'active' || s === 'idle' ? 'live' : s); // 대기 합성은 active⇄idle 만 바꾼다
  for (const n of graph.nodes.values()) {
    const r = finalState.nodes.get(n.id);
    if (!r) { out.push({ id: n.id, field: 'missing' }); continue; }
    for (const f of ['parentId', 'depth', 'label', 'endedAt']) {
      if ((r[f] ?? null) !== (n[f] ?? null)) out.push({ id: n.id, field: f, replay: r[f] ?? null, graph: n[f] ?? null });
    }
    if (act(r.status) !== act(n.status)) out.push({ id: n.id, field: 'status', replay: r.status, graph: n.status });
  }
  return out;
}

// ───────────── 빌드 ─────────────

/** 지문: 메인 파일 + subagents 트리 jsonl + 매칭된 claude -p 자식 파일 */
export async function fingerprintOf(entry, childFiles = []) {
  const parts = [];
  let bytes = 0;
  try { const st = await fs.promises.stat(entry.file); parts.push(`m:${st.size}:${Math.round(st.mtimeMs)}`); bytes += st.size; } catch { parts.push('m:-'); }
  let count = 0, maxM = 0;
  const scan = async (dir, depth) => {
    let ents = [];
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of ents) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth < 2) await scan(p, depth + 1); continue; }
      if (!d.name.endsWith('.jsonl')) continue;
      try { const st = await fs.promises.stat(p); count++; bytes += st.size; if (st.mtimeMs > maxM) maxM = st.mtimeMs; } catch {}
    }
  };
  await scan(path.join(entry.projectPath, entry.sessionId, 'subagents'), 0);
  parts.push(`s:${count}:${Math.round(maxM)}`);
  for (const f of childFiles) {
    try { const st = await fs.promises.stat(f); parts.push(`c:${st.size}:${Math.round(st.mtimeMs)}`); bytes += st.size; } catch { parts.push('c:-'); }
  }
  return { fingerprint: parts.join('|'), bytes };
}

/**
 * buildReplay({ sessionId, index, privacy, onProgress }) → ReplayData
 */
export async function buildReplay({ sessionId, index, privacy = 'summary', maxDepth = 8, job = null, jobRules = undefined } = {}) {
  const t0 = performance.now();
  let e = index.findSession(sessionId);
  if (!e) { await index.refresh(); e = index.findSession(sessionId); }
  if (!e) throw Object.assign(new Error('session not found'), { code: 'ENOSESSION' });
  const rt = new RootRuntime({ sessionId: e.sessionId, index, privacy, maxDepth, offline: true, jobRules }); // jobRules:(시험용 — 기본은 설정 파일)
  if (job) job.rt = rt;
  await rt.loadOffline();
  const loadMs = performance.now() - t0;
  const { events, startT, endT } = await normalize(rt);
  const childFiles = rt.children.filter((c) => c.matched).map((c) => index.findSession(c.matched)?.file).filter(Boolean);
  const fp = await fingerprintOf(e, childFiles);
  const live = index.liveStatus(e.sessionId);
  const complete = !(live === 'busy' || Date.now() - e.mtimeMs < 120_000);
  const root = rt.graph.get(`s:${e.sessionId}`);
  const data = await assemble({
    // 재생 제목은 목록용: 노드 label 이 역할 표기("메인 · …")여도 제목은 custom > ai > 첫 프롬프트를 유지
    sessionId: e.sessionId, title: (root && !root.meta?.customTitle && root.meta?.title) || root?.label || e.title, events, startT, endT, complete,
    extra: { fields: { fingerprint: fp.fingerprint, _childFiles: childFiles } },
  });
  const mism = finalMismatches(data.finalState, rt.graph);
  data.stats = {
    ...data.stats,
    buildMs: Math.round(performance.now() - t0), loadMs: Math.round(loadMs),
    files: rt.tails.size, bytes: fp.bytes, finalMismatch: mism.length,
  };
  data.buildMs = data.stats.buildMs;
  if (mism.length && process.env.CCVIZ_DEBUG) console.error('[ccviz] ' + t('server.replayMismatch'), mism.slice(0, 10));
  return data;
}

/** --demo: web/demo-events.jsonl 을 재생 데이터로 */
export async function buildReplayFromEvents({ sessionId, events: raw, title = null, complete = true }) {
  const items = [];
  raw.forEach((ev, i) => {
    const e = { ...ev };
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) return;
    items.push({ e, t, o: i * 4, moved: false });
  });
  const events = sortAndNumber(items);
  const startT = events.length ? events[0].t : Date.now();
  const endT = events.length ? events[events.length - 1].t : startT;
  const data = await assemble({ sessionId, title, events, startT, endT, complete, extra: { fields: { fingerprint: 'static', _childFiles: [] } } });
  data.stats.buildMs = 0;
  data.buildMs = 0;
  return data;
}

// ───────────── 조회 (타임라인·페이지·스냅샷) ─────────────

/** t ≤ at 인 마지막 이벤트 index(+1 = 개수) */
function countAtOrBefore(events, at) {
  let a = 0, b = events.length;
  while (a < b) { const m = (a + b) >> 1; if (events[m].t <= at) a = m + 1; else b = m; }
  return a;
}
function firstAtOrAfter(events, t) {
  let a = 0, b = events.length;
  while (a < b) { const m = (a + b) >> 1; if (events[m].t < t) a = m + 1; else b = m; }
  return a;
}

export function timelineOf(data, bucketsReq = 240) {
  const B = Math.min(1000, Math.max(50, Math.round(Number(bucketsReq) || 240)));
  data._tl = data._tl || new Map();
  if (data._tl.has(B)) return data._tl.get(B);
  const startT = Date.parse(data.startTs), endT = Date.parse(data.endTs);
  const dur = Math.max(1, endT - startT);
  const size = Math.max(1, Math.ceil(dur / B));
  const counts = new Array(B).fill(0), tools = new Array(B).fill(0), errors = new Array(B).fill(0), spawns = new Array(B).fill(0);
  const gaps = [];
  let prev = null;
  for (const ev of data.events) {
    const k = Math.min(B - 1, Math.max(0, Math.floor((ev.t - startT) / size)));
    counts[k]++;
    if (ev.type === 'tool-start') tools[k]++;
    else if ((ev.type === 'tool-end' || ev.type === 'result') && ev.ok === false) errors[k]++;
    else if (ev.type === 'node-update' && ev.patch?.status === 'error') errors[k]++;
    else if (ev.type === 'node-add' && ev.node && ev.node.kind !== 'main') spawns[k]++;
    // 공백 구간은 실제 기록 기준(합성 대기·재개 node-update 는 활동으로 치지 않음)
    if (ev.synth && ev.type === 'node-update') continue;
    if (prev != null && ev.t - prev >= GAP_MS) gaps.push({ from: iso(prev), to: iso(ev.t) });
    prev = ev.t;
  }
  const tl = {
    sessionId: data.sessionId, root: data.root, title: data.title, startTs: data.startTs, endTs: data.endTs,
    durationMs: endT - startT, eventCount: data.events.length, nodeCount: data.nodeIndex.length,
    complete: data.complete, builtAt: data.builtAt, buildMs: data.buildMs ?? 0,
    buckets: { size, counts, tools, errors, spawns },
    gaps,
    highlights: data._hl || (data._hl = computeHighlights(data.events)), // 볼거리 시점
    nodes: data.nodeIndex,
  };
  data._tl.set(B, tl);
  return tl;
}

export function pageOf(data, { from = null, fromT = null, limit = PAGE_DEFAULT } = {}) {
  const lim = Math.min(PAGE_MAX, Math.max(1, Math.round(Number(limit) || PAGE_DEFAULT)));
  const total = data.events.length;
  let start;
  if (fromT != null && fromT !== '' && Number.isFinite(Number(fromT))) start = firstAtOrAfter(data.events, Number(fromT));
  else start = Math.max(0, Math.round(Number(from) || 1) - 1);
  start = Math.min(start, total);
  const events = data.events.slice(start, start + lim);
  const end = start + events.length;
  // builtAt: 페이지마다 빌드 식별자. 여러 페이지를 받는 사이 서버가 다시 만들면(stale-while-revalidate) 클라이언트가 알아챈다
  return { sessionId: data.sessionId, builtAt: data.builtAt, from: start + 1, next: end < total ? end + 1 : null, total, events };
}

export function snapshotAt(data, at) {
  const atMs = Number(at);
  const n = Number.isFinite(atMs) ? countAtOrBefore(data.events, atMs) : data.events.length; // 적용할 이벤트 수
  let kf = data.keyframes[0];
  for (let i = data.keyframes.length - 1; i >= 0; i--) if (data.keyframes[i].rseq <= n) { kf = data.keyframes[i]; break; }
  const st = createState();
  st.root = kf.root;
  st.seq = kf.rseq;
  for (const nd of kf.nodes) st.nodes.set(nd.id, cloneNode(nd));
  for (let i = kf.rseq; i < n; i++) applyEvent(st, data.events[i]);
  const recent = data.events.slice(Math.max(0, n - RECENT_MAX), n);
  return {
    sessionId: data.sessionId, root: st.root || data.root, at: Number.isFinite(atMs) ? atMs : null,
    rseq: n, seq: n, nodes: [...st.nodes.values()], recent,
  };
}

// ───────────── 캐시 (메모리 전용 LRU, 단일 비행, 전역 대기열) ─────────────

export class ReplayCache {
  constructor({ index, privacy = 'summary', max = 2, maxDepth = 8, reuseMs = 30_000, maxPending = 6, idPrefix = '' } = {}) {
    // 보관함 재생은 세션 id 앞에 'arc:' 를 붙여 내보낸다(원본·보관함 같은 세션이 캐시·URL·엔진에서 섞이지 않게)
    this.idPrefix = idPrefix;
    this.maxPending = Math.max(1, maxPending); // 대기열 상한(넘으면 EBUSY → 503)
    this.index = index;
    this.privacy = privacy;
    this.max = Math.max(1, max);
    this.maxDepth = maxDepth;
    this.reuseMs = reuseMs;
    this.cache = new Map(); // sid → ReplayData (삽입 순서 = LRU)
    this.jobs = new Map(); // sid → job
    this.queue = Promise.resolve();
  }

  _touch(sid, data) { this.cache.delete(sid); this.cache.set(sid, data); return data; }

  /** 'arc:<id>' → '<id>' (idPrefix 가 있을 때) */
  _key(sid) {
    const s = String(sid || '');
    return this.idPrefix && s.startsWith(this.idPrefix) ? s.slice(this.idPrefix.length) : s;
  }

  /** 다시 만들지 않고 캐시만 본다(/replay/events·/replay/snapshot) */
  peek(sid) {
    sid = this._key(sid);
    const d = this.cache.get(sid);
    return d ? this._touch(sid, d) : null;
  }

  has(sid) { return this.cache.has(this._key(sid)); }

  progressOf(sid) {
    const job = this.jobs.get(sid);
    if (!job) return null;
    const p = job.rt ? job.rt.progress() : { bytesRead: 0, files: 0 };
    return { bytesRead: p.bytesRead, bytesTotal: Math.max(job.bytesTotal || 0, p.bytesRead), files: p.files };
  }

  _start(sid, entry) {
    let job = this.jobs.get(sid);
    if (job) return job;
    if (this.jobs.size >= this.maxPending) throw Object.assign(new Error('replay build queue full'), { code: 'EBUSY' });
    job = { rt: null, bytesTotal: 0, promise: null };
    this.jobs.set(sid, job);
    const run = async () => {
      try { job.bytesTotal = (await fingerprintOf(entry, [])).bytes; } catch {}
      return buildReplay({ sessionId: sid, index: this.index, privacy: this.privacy, maxDepth: this.maxDepth, job });
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    job.promise = p.then((data) => {
      data.stale = false;
      if (this.idPrefix) data.sessionId = this.idPrefix + data.sessionId; // 응답(timeline·events·snapshot)에 나가는 id
      this._touch(sid, data);
      while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value);
      return data;
    }).finally(() => { if (this.jobs.get(sid) === job) this.jobs.delete(sid); });
    job.promise.catch(() => {}); // 기다리는 쪽이 없어도 처리되지 않은 거부로 남지 않게
    return job;
  }

  /** manager.replay(sid, { refresh, wait }) → ReplayData | {building:true, progress} */
  async get(sid, { refresh = false, wait = true, waitMs = 50_000 } = {}) {
    sid = this._key(sid);
    let e = this.index.findSession(sid);
    // 모르는 id 마다 전체 색인을 다시 읽지 않는다(4초에 한 번, list() 와 같은 간격)
    if (!e && Date.now() - (this.index.lastRefresh || 0) > 4000) { await this.index.refresh(); e = this.index.findSession(sid); }
    if (!e) throw Object.assign(new Error('session not found'), { code: 'ENOSESSION' });
    const key = e.sessionId;
    const cached = this.cache.get(key);
    if (cached && !this.jobs.has(key)) {
      const fp = await fingerprintOf(e, cached._childFiles || []);
      if (fp.fingerprint === cached.fingerprint) return this._touch(key, cached);
      const age = Date.now() - Date.parse(cached.builtAt);
      // 다시 만드는 간격: 기본 30초, 빌드가 오래 걸리는 큰 세션은 빌드 시간의 30배(재빌드 CPU 점유 ≤ 약 3%)
      const reuse = Math.max(this.reuseMs, 30 * (cached.buildMs || 0));
      if (age < (refresh ? Math.min(5000, reuse) : reuse)) return this._touch(key, cached); // 방금 다시 만든 것은 refresh 도 무시
      if (!refresh) {
        // 바뀌는 중(라이브) 세션: 있는 빌드를 바로 주고 뒤에서 다시 만든다(stale-while-revalidate)
        try { this._start(key, e); } catch {}
        cached.stale = true;
        return this._touch(key, cached);
      }
    } else if (cached && !refresh) {
      cached.stale = true;
      return this._touch(key, cached); // 다시 만드는 중이면 그동안은 있는 빌드
    }
    let job;
    try { job = this._start(key, e); } catch (err) {
      if (err.code === 'EBUSY' && cached) { cached.stale = true; return this._touch(key, cached); } // 대기열이 차면 있는 빌드라도
      throw err;
    }
    if (!wait) return { building: true, progress: this.progressOf(key) || { bytesRead: 0, bytesTotal: 0, files: 0 } };
    let timer;
    const TIMEOUT = Symbol('timeout');
    const r = await Promise.race([job.promise, new Promise((res) => { timer = setTimeout(() => res(TIMEOUT), waitMs); })])
      .finally(() => clearTimeout(timer));
    if (r === TIMEOUT) return { building: true, progress: this.progressOf(key) || { bytesRead: 0, bytesTotal: 0, files: 0 } };
    return r;
  }
}

/**
 * 출력 줄 배분 시각. 기본은 시작 → 끝 사이 줄 수에 비례. 분리 프로세스는 들여다본 결과에 보인 줄(그 시각까지 로그에
 * 있던 줄)을 닻으로 삼아 닻 사이를 나눈다 — 첫 1만 줄이 1초에 쏟아지고 나머지가 몇 시간 걸린 로그도 실제 흐름에 가깝게.
 * @param lines 로그 전체 줄 · anchors [{line(앞뒤 공백 뺀 줄), t(ms)}] | null
 * @returns (k) => 앞 k 줄까지 쓰인 시각(ms)
 */
export function lineTimer(lines, anchors, start, end) {
  const L = lines.length;
  const lin = (k) => Math.min(end, start + Math.round(((end - start) * k) / Math.max(1, L)));
  if (!anchors || !anchors.length || !L) return lin;
  const at = new Map();
  lines.forEach((l, i) => { const k = l.trim(); if (!k) return; if (!at.has(k)) at.set(k, []); at.get(k).push(i); });
  const pts = [[0, start]];
  let from = 0;
  for (const a of [...anchors].sort((x, y) => x.t - y.t)) {
    const list = at.get(a.line);
    const i = list && list.find((x) => x >= from);
    if (i == null || !Number.isFinite(a.t)) continue;
    const prev = pts[pts.length - 1];
    const t = Math.min(end, Math.max(prev[1], a.t));
    if (i + 1 <= prev[0]) continue;
    pts.push([i + 1, t]);
    from = i;
  }
  if (pts.length === 1) return lin;
  const last = pts[pts.length - 1];
  if (last[0] < L) pts.push([L, Math.max(last[1], end)]);
  return (k) => {
    for (let j = 1; j < pts.length; j++) {
      const [k1, t1] = pts[j], [k0, t0] = pts[j - 1];
      if (k <= k1) return Math.round(t0 + ((t1 - t0) * (k - k0)) / Math.max(1, k1 - k0));
    }
    return pts[pts.length - 1][1];
  };
}
