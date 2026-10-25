// 노드 트리·이벤트 링버퍼·전역 seq
import { redact } from './redact.mjs';
import { LIMITS, truncate, truncateTail } from './parse.mjs';
import { BRIEF_LIMITS } from './brief.mjs';
import { sanitizePanel } from './panel.mjs';
import { sanitizeIx } from './interactions.mjs';
import { sanitizeArt } from './artifacts.mjs';

// 홀로그램 패널 내용: 이 필드들은 sanitizePanel(마스킹·상한·minimal 삭제)을 지난다
const PANEL_FIELDS = ['panel', 'parentPanel'];
// 라이브 폭주 솎기: 1초 창에서 전체 PANEL_RATE 건, 노드당 PANEL_NODE_RATE 건을 넘으면 줄을 줄인다
export const PANEL_RATE = 40, PANEL_NODE_RATE = 8, PANEL_THIN_LINES = 3;

/** 같은 패널을 가리키는 열쇠(스냅샷에서 최신 것만 남길 때) */
export function panelKey(ev, field = 'panel') {
  const p = ev[field];
  if (!p) return null;
  if (p.ref && p.ref.nodeId) return `${p.ref.nodeId}|${p.ref.toolUseId ?? ''}`;
  if (p.mode === 'say') return `say|${ev.nodeId}`;
  return `${ev.nodeId}|${ev.toolUseId ?? ''}`;
}

const BRIEF_FIELDS = ['brief', 'detail'];
const BRIEF_MAX = { brief: BRIEF_LIMITS.say, detail: BRIEF_LIMITS.detail };

let SEQ = 0;
export function nextSeq() { return ++SEQ; }
export function currentSeq() { return SEQ; }

const RING_MAX = 5000;
const RECENT_MAX = 300;

const TEXT_LIMIT = {
  'tool-start': LIMITS.tool, 'tool-end': LIMITS.tool,
  text: LIMITS.text, user: LIMITS.text, result: LIMITS.text, output: LIMITS.output,
};

export class Graph {
  /**
   * @param {{rootSessionId?:string, privacy?:string, keepAll?:boolean, localSeq?:boolean, now?:=>string}} opts
   *  keepAll: 링버퍼를 자르지 않고 finishLoad 도 재번호하지 않음(재생 재구성용)
   *  localSeq: 전역 SEQ 대신 이 그래프만의 카운터 사용
   *  now: 시각이 없는 이벤트에 쓸 시계(기본 지금 시각)
   */
  constructor({ rootSessionId, privacy = 'summary', keepAll = false, localSeq = false, now = null } = {}) {
    this.rootSessionId = rootSessionId;
    this.rootId = rootSessionId ? `s:${rootSessionId}` : null;
    this.privacy = privacy;
    this.nodes = new Map();
    this.order = []; // 생성 순서
    this.ring = [];
    this.subs = new Set();
    this.loading = true;
    this.lastSeq = 0;
    this.keepAll = keepAll;
    this.localSeq = localSeq;
    this._seq = 0;
    this._now = now || (() => new Date().toISOString());
  }

  has(id) { return this.nodes.has(id); }
  get(id) { return this.nodes.get(id); }

  /** 노드 추가. 이미 있으면 기존 노드를 돌려준다. */
  addNode(n, ts) {
    if (this.nodes.has(n.id)) return this.nodes.get(n.id);
    const now = ts || this._now();
    const parent = n.parentId ? this.nodes.get(n.parentId) : null;
    const node = {
      id: n.id,
      parentId: n.parentId ?? null,
      kind: n.kind,
      label: truncate(redact(n.label || n.id), 120),
      model: n.model ?? null,
      status: n.status || 'active',
      startedAt: n.startedAt || now,
      endedAt: n.endedAt ?? null,
      lastActivityAt: n.lastActivityAt || now,
      depth: parent ? parent.depth + 1 : (n.depth ?? 0),
      sessionId: n.sessionId ?? null,
      meta: {
        agentType: null, toolUseId: null, phase: null, cwd: null, command: null, skill: null, background: false,
        ...(n.meta || {}),
      },
      counts: { tools: 0, errors: 0, texts: 0 },
      openTools: [],
    };
    if (node.meta.command) node.meta.command = truncate(redact(node.meta.command), 200);
    this.nodes.set(node.id, node);
    this.order.push(node.id);
    this.emit({ ts: now, type: 'node-add', nodeId: node.id, node: structuredClone(node) });
    return node;
  }

  /** 바뀐 필드만 patch 로 낸다. meta 는 얕은 병합 */
  updateNode(id, patch, ts, extra = null) { // extra: 이벤트에 덧붙일 필드(ix)
    const node = this.nodes.get(id);
    if (!node) return null;
    const out = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'meta') {
        const mp = {};
        for (const [mk, mv] of Object.entries(v || {})) {
          const val = mk === 'command' && mv ? truncate(redact(mv), 200) : mv;
          if (node.meta[mk] !== val) { node.meta[mk] = val; mp[mk] = val; }
        }
        if (Object.keys(mp).length) out.meta = mp;
      } else if (k === 'label') {
        const val = truncate(redact(v || ''), 120);
        if (val && node.label !== val) { node.label = val; out.label = val; }
      } else if (node[k] !== v) {
        node[k] = v; out[k] = v;
      }
    }
    if ('parentId' in out) {
      // 깊이 재계산 (자손까지)
      this._redepth(node, out);
    }
    if (Object.keys(out).length === 0) return null;
    this.emit({ ts: ts || this._now(), type: 'node-update', nodeId: id, patch: out, ...(extra || {}) });
    return out;
  }

  _redepth(node, out) {
    const parent = node.parentId ? this.nodes.get(node.parentId) : null;
    const d = parent ? parent.depth + 1 : 0;
    if (node.depth !== d) { node.depth = d; out.depth = d; }
    const stack = [node];
    while (stack.length) {
      const p = stack.pop();
      for (const c of this.nodes.values()) {
        if (c.parentId === p.id && c.depth !== p.depth + 1) {
          c.depth = p.depth + 1;
          this.emit({ ts: this._now(), type: 'node-update', nodeId: c.id, patch: { depth: c.depth } });
          stack.push(c);
        }
      }
    }
  }

  isAncestor(maybeAncestor, id) {
    let cur = this.nodes.get(id);
    for (let i = 0; cur && i < 64; i++) {
      if (cur.parentId === maybeAncestor) return true;
      cur = cur.parentId ? this.nodes.get(cur.parentId) : null;
    }
    return false;
  }

  /** 이벤트 발행: redact·길이 제한·privacy 적용, seq 부여 */
  emit(ev) {
    if (ev.text != null) {
      const lim = TEXT_LIMIT[ev.type] || LIMITS.text;
      if (this.privacy === 'minimal') ev.text = '';
      else ev.text = (ev.type === 'output' ? truncateTail : truncate)(redact(ev.text), lim);
    }
    // 작업 요약: text 와 같은 마스킹·길이 상한, minimal 이면 비움
    for (const k of BRIEF_FIELDS) {
      if (ev[k] == null) continue;
      ev[k] = this.privacy === 'minimal' ? '' : truncate(redact(ev[k]), BRIEF_MAX[k]);
    }
    for (const k of PANEL_FIELDS) {
      if (ev[k] == null) continue;
      const p = sanitizePanel(ev[k], this.privacy);
      if (p) ev[k] = p; else delete ev[k];
    }
    if ((ev.panel || ev.parentPanel) && !this.loading && !this.keepAll) this._thinPanels(ev);
    if (ev.ix != null) { const x = sanitizeIx(ev.ix, this.privacy); if (x) ev.ix = x; else delete ev.ix; } // 상호작용 메타(이름은 redact·minimal 이면 뺌)
    if (ev.art != null) { const a = sanitizeArt(ev.art, this.privacy); if (a) ev.art = a; else delete ev.art; } // 작업 대상(경로·이름 정리, minimal 이면 접기)
    const out = { seq: 0, ts: ev.ts || this._now(), ...ev };
    out.seq = this.localSeq ? ++this._seq : nextSeq();
    this.ring.push(out);
    if (!this.keepAll && this.ring.length > RING_MAX) this.ring.splice(0, this.ring.length - RING_MAX);
    this.lastSeq = out.seq;
    if (!this.loading) for (const fn of this.subs) { try { fn(out); } catch { /* 구독자 오류 무시 */ } }
    return out;
  }

  /** 라이브 폭주 때 패널 줄을 줄인다(제목·결과 끝 몇 줄만, thin:true). 이벤트 자체는 그대로 보낸다 */
  _thinPanels(ev) {
    const now = Date.now();
    const w = this._pw || (this._pw = { t0: now, all: 0, node: new Map() });
    if (now - w.t0 >= 1000) { w.t0 = now; w.all = 0; w.node.clear(); }
    w.all++;
    const nn = (w.node.get(ev.nodeId) || 0) + 1;
    w.node.set(ev.nodeId, nn);
    if (w.all <= PANEL_RATE && nn <= PANEL_NODE_RATE) return;
    for (const k of PANEL_FIELDS) {
      const p = ev[k];
      if (!p || p.lines.length <= PANEL_THIN_LINES) { if (p) p.thin = true; continue; }
      const drop = p.lines.length - PANEL_THIN_LINES;
      const fromHead = p.part === 'tail' || p.mode === 'shell' || p.mode === 'monitor' || p.mode === 'say';
      p.lines = fromHead ? p.lines.slice(drop) : p.lines.slice(0, PANEL_THIN_LINES);
      p.marks = fromHead ? p.marks.slice(drop) : p.marks.slice(0, PANEL_THIN_LINES);
      p.more = (p.more || 0) + drop;
      p.thin = true;
    }
  }

  /** 초기 로드 완료: 링버퍼를 시각순 최근 300건으로 줄이고 seq 를 새로 매긴다 */
  finishLoad() {
    if (this.keepAll) { this.loading = false; return; }
    const sorted = this.ring.map((e, i) => [e, i]).sort((a, b) => {
      const ta = Date.parse(a[0].ts) || 0, tb = Date.parse(b[0].ts) || 0;
      return ta - tb || a[1] - b[1];
    }).map((x) => x[0]);
    const keep = sorted.slice(-RECENT_MAX);
    for (const e of keep) e.seq = nextSeq();
    this.ring = keep;
    this.lastSeq = SEQ;
    this.loading = false;
  }

  snapshot() {
    return {
      root: this.rootId,
      sessionId: this.rootSessionId,
      seq: this.lastSeq,
      nodes: this.order.map((id) => this.nodes.get(id)).filter(Boolean),
      recent: latestPanelsOnly(this.ring.slice(-RECENT_MAX)),
    };
  }

  /** since 다음 이벤트들. 링버퍼 밖이면 null */
  eventsSince(since) {
    if (!Number.isFinite(since) || since < 0) return null;
    if (since > this.lastSeq) return null;
    if (this.ring.length === 0) return since === this.lastSeq ? [] : null;
    const first = this.ring[0].seq;
    if (since < first - 1) return null;
    return this.ring.filter((e) => e.seq > since);
  }

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
}

/**
 * 스냅샷 recent 에서 같은 패널(panelKey)의 내용은 가장 늦은 이벤트에만 남긴다(— 웹은 최신 내용만 쓰므로 전송량 절약).
 * 원본 링버퍼는 건드리지 않고 복사본을 돌려준다.
 */
export function latestPanelsOnly(events) {
  const seen = new Set();
  const out = new Array(events.length);
  for (let i = events.length - 1; i >= 0; i--) {
    let e = events[i];
    for (const k of PANEL_FIELDS) {
      if (!e[k]) continue;
      const key = k + ':' + panelKey(e, k);
      if (seen.has(key)) { if (e === events[i]) e = { ...e }; delete e[k]; } else seen.add(key);
    }
    out[i] = e;
  }
  return out;
}
