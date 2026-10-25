// 3차: 전체 보기 허브 — 여러 루트 세션을 동시에 붙들어 하나의 스트림으로
// 루트 런타임은 RootManager 와 공유(같은 RootRuntime·같은 이벤트)하고, 허브는 자기 링버퍼와 seq(hseq)를 가진다.
import { buildProjects, cachedActivity } from './projects.mjs';
import { launcherIndexOf } from './launcher.mjs';
import { ConflictTracker, conflictEvent, sessionMsgEvent, CONFLICT_WINDOW_MS } from '../web/conflict-core.mjs';
import { t } from './cli-i18n.mjs';

/** tool-start 의 파일 접촉들(셸 추정이면 files 배열, 없으면 file 하나) */
const fileList = (e) => (Array.isArray(e.files) && e.files.length ? e.files : e.file ? [e.file] : []);

const RING_MAX = 5000;
const RECENT_MAX = 300;
const log = (...a) => console.error('[ccviz] overview', ...a);

/**
 * 루트 공급자(source) 인터페이스
 *  desired → Promise<{roots:[{sessionId, projectId, live, liveStatus, tier, orphanSdk, activityMs}], overflow?:Set}>
 *  acquire(sid) → Promise<runtime{graph}>   release(sid)
 *  projects({overview}) → Promise<projects[]>   (항목)
 */
export class OverviewHub {
  constructor({ source, intervalMs = 5000, orphanDelayMs = 30_000, graceMs = 600_000, sleepMs = 120_000,
    projectsMinMs = 5000, now = () => Date.now() } = {}) {
    this.source = source;
    this.intervalMs = intervalMs;
    this.orphanDelayMs = orphanDelayMs;
    this.graceMs = graceMs;
    this.sleepMs = sleepMs;
    this.projectsMinMs = projectsMinMs;
    this.now = now;
    this.roots = new Map(); // sid → R
    this.owner = new Map(); // nodeId → sid
    this.ring = []; // [{ev, aud}]
    this.hseq = 0;
    this.subs = new Set();
    this.awake = false;
    this.timer = null;
    this.sleepTimer = null;
    this._ticking = null;
    this.firstSeen = new Map(); // 독립 sdk-cli 후보 sid → 처음 본 시각
    this.projectsState = { projects: [], json: '', at: 0, pending: false };
    this.stopped = false;
    this._warned = new Set();
    this.stats = { ticks: 0, lastTickMs: 0, emitted: 0 };
    // 세션 간 같은 파일 충돌(live 메인 = 그룹)·세션 간 메시지
    this.conf = new ConflictTracker();
  }

  // ───────────── 수명 ─────────────

  /** 깨어 있지 않으면 깨우고 첫 계산을 기다린다 */
  async wake() {
    if (this.stopped) return;
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    if (!this.awake) {
      this.awake = true;
      this.timer = setInterval(() => { this.tick().catch((e) => log('tick', e?.message || e)); }, this.intervalMs);
      this.timer.unref?.();
    }
    await this.tick();
    if (!this.subs.size) this._scheduleSleep();
  }

  _scheduleSleep() {
    if (this.sleepTimer || this.subs.size || !this.awake) return;
    this.sleepTimer = setTimeout(() => { this.sleepTimer = null; if (!this.subs.size) this.sleep(); }, this.sleepMs);
    this.sleepTimer.unref?.();
  }

  /** 구독자 0 → 루트를 모두 놓고 잠든다. hseq 는 이어서 센다 */
  sleep() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.awake = false;
    for (const R of [...this.roots.values()]) this._drop(R, { reoffer: false });
    this.owner.clear();
    this.ring = [];
    this.firstSeen.clear();
    this.conf.clear();
  }

  stop() {
    this.stopped = true;
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleep();
  }

  /** sub = {inactive:boolean, onEvent(ev), onProjects(payload)}.
   *  inactive:true = 숨은 루트(R.visible=false — 기동기가 붙든 끝난 메인 등)까지 받는 내부 구독(시험·진단용). /events 는 늘 false */
  subscribe(sub) {
    this.subs.add(sub);
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    return () => { this.subs.delete(sub); if (!this.subs.size) this._scheduleSleep(); };
  }

  // ───────────── 주기 계산 ─────────────

  tick() {
    if (this._ticking) return this._ticking;
    this._ticking = this._tick().finally(() => { this._ticking = null; });
    return this._ticking;
  }

  async _tick() {
    if (this.stopped || !this.awake) return;
    const t0 = Date.now();
    const want = await this.source.desired();
    if (!this.awake || this.stopped) return;
    const now = this.now();
    const wantMap = new Map();
    for (const r of want.roots || []) {
      if (r.orphanSdk) {
        if (!this.firstSeen.has(r.sessionId)) this.firstSeen.set(r.sessionId, now);
        if (now - this.firstSeen.get(r.sessionId) < this.orphanDelayMs) continue; // 30초 기다려 부모 매칭 기회를 준다
      }
      wantMap.set(r.sessionId, r);
    }
    for (const sid of [...this.firstSeen.keys()]) if (!(want.roots || []).some((r) => r.sessionId === sid)) this.firstSeen.delete(sid);

    for (const [sid, r] of wantMap) {
      const R = this.roots.get(sid);
      if (!R) {
        // 그 세션 노드가 이미 다른 루트 안(claude -p 자식)에 있으면 따로 붙이지 않는다
        const o = this.owner.get(`s:${sid}`);
        if (o && o !== sid) continue;
        await this._addRoot(r);
      } else {
        if (r.live) R.leftAt = null;
        else if (R.meta.live) R.leftAt = now;
        this._setMeta(R, { live: !!r.live, liveStatus: r.liveStatus ?? null, tier: r.live ? 'live' : 'recent',
          ...(R.orphanSdk ? { likelyMain: r.likelyMain ?? null, unlinkedReason: r.unlinkedReason ?? null } : {}) });
        this._setVisible(R, this._visibleOf(R, now));
      }
    }
    for (const R of [...this.roots.values()]) {
      if (wantMap.has(R.sid)) continue;
      // live 에서 빠짐: 바로 지우지 않고 recent 로 표시 → 10분 뒤에도 아니면 서브트리 제거
      if (R.meta.live) { R.leftAt = now; this._setMeta(R, { live: false, liveStatus: null, tier: 'recent' }); }
      if ((R.leftAt == null || now - R.leftAt > this.graceMs) && !this._hasLiveHandoff(R)) this._removeRoot(R); // 넘긴 기동기가 살아 있으면 둔다
      else this._setVisible(R, this._visibleOf(R, now));
    }
    // 충돌: live 가 아닌 루트는 그룹에서 빼고, 창(10분)을 벗어난 접촉은 정리
    for (const [sid] of this._confGroups()) if (!this._isGroup(this.roots.get(sid))) this._confOut(this.conf.dropGroup(sid));
    this._confOut(this.conf.evaluate(Date.now()));
    // 프로젝트 집계는 루트 집합·상태가 바뀌었거나 두 tick 에 한 번(약 10초)
    const rk = JSON.stringify(this.rootsPayload(true));
    if (rk !== this._lastRootsKey || this.stats.ticks % 2 === 0 || !this.projectsState.at) {
      this._lastRootsKey = rk;
      await this._refreshProjects(want);
    }
    this.stats.ticks++;
    this.stats.lastTickMs = Date.now() - t0;
  }

  _visibleOf(R, now) {
    if (R.meta.live) return true;
    if (R.leftAt != null && this._hasLiveHandoff(R)) return true;
    return R.leftAt != null && now - R.leftAt <= this.graceMs;
  }

  // ───────────── 루트 추가·제거 ─────────────

  async _addRoot(r) {
    const sid = r.sessionId;
    let rt;
    try { rt = await this.source.acquire(sid); } catch (e) { log(t('server.acquireFail'), sid.slice(0, 8), e?.message || e); return; }
    if (this.roots.has(sid) || !this.awake || this.stopped) { this.source.release(sid); return; }
    const g = rt.graph;
    const R = {
      sid, projectId: r.projectId, rt, rootNodeId: g.rootId || `s:${sid}`, ids: new Set(), unsub: null,
      orphanSdk: !!r.orphanSdk, leftAt: null, visible: true,
      meta: { live: !!r.live, liveStatus: r.liveStatus ?? null, tier: r.live ? 'live' : 'recent',
        ...(r.orphanSdk ? { orphanSdk: true, likelyMain: r.likelyMain ?? null, unlinkedReason: r.unlinkedReason ?? null } : {}) },
    };
    R.visible = this._visibleOf(R, this.now());
    this.roots.set(sid, R);
    // 지금 그래프 상태를 생성 순서대로 node-add 로 내보낸다(spawn)
    const ts = new Date().toISOString();
    for (const id of g.order) {
      const node = g.nodes.get(id);
      if (!node) continue;
      if (!this._claim(R, id)) continue;
      this._emit(R, { ts, type: 'node-add', nodeId: id, node: structuredClone(node) });
    }
    R.unsub = g.subscribe((e) => this._onRootEvent(R, e));
    this._announceHandoff(R); // 이 루트가 이어받은 옛 루트의 살아 있는 기동기를 새 메인 옆으로
    // 붙기 전 10분 안의 파일 접촉을 충돌 추적기에 넣는다(재접속·서버 재기동 뒤에도 같은 답)
    if (this._isGroup(R)) {
      const lo = Date.now() - CONFLICT_WINDOW_MS;
      for (const e of g.ring) {
        if (e.type !== 'tool-start' || !e.file || this.owner.get(e.nodeId) !== R.sid) continue;
        const t = Date.parse(e.ts);
        if (t >= lo) for (const f of fileList(e)) this._confOut(this.conf.touch(R.sid, f, t, e.nodeId));
      }
    }
  }

  /** 노드 id 소유권. 다른 루트가 가졌으면: 그 루트가 독립 sdk 루트이고 그 루트 노드면 흡수(remove→add), 아니면 버림 */
  _claim(R, id) {
    const o = this.owner.get(id);
    // /clear 승계: 이 루트가 이어받은 작업의 부모가 이어받은 루트 쪽에 있으면(옛 트리의 그 작업 아래 노드) 옛 루트는 내보내지 않는다
    if (this._underHandoff(R, id)) return false;
    if (!o || o === R.sid) { this.owner.set(id, R.sid); R.ids.add(id); return true; }
    const other = this.roots.get(o);
    // /clear 승계: 새 메인 루트가 옛 메인 루트에서 이어받은 작업이면 옛 쪽(그 아래 포함)을 걷고 새 쪽이 갖는다
    if (other && R.rt?.inheritedIds?.has?.(id) && R.rt.inheritedFrom?.has?.(o)) {
      this._handOver(other, id);
      this.owner.set(id, R.sid); R.ids.add(id);
      return true;
    }
    if (other && other.orphanSdk && other.rootNodeId === id) {
      this._removeRoot(other, { reoffer: false }); // 독립 루트 서브트리 node-remove 먼저
      this.owner.set(id, R.sid); R.ids.add(id);
      return true;
    }
    if (!this._warned.has(id)) { this._warned.add(id); log(t('server.dupNode'), id.slice(0, 14)); }
    return false;
  }

  // ───────────── /clear 승계 ─────────────

  /** R(옛 메인)에서 이어받은 live 루트(새 메인) */
  _successorOf(sid) {
    for (const S of this.roots.values()) if (S.sid !== sid && S.meta.live && S.rt?.inheritedFrom?.has?.(sid)) return S;
    return null;
  }

  /** id 가 R 안에서 다른 루트(R 을 이어받은)로 넘어간 노드의 자손인지. 넘어간 쪽 부모를 R.handed 에 적어 둔다 */
  _underHandoff(R, id) {
    const g = R.rt?.graph;
    let cur = g?.get(id);
    for (let i = 0; cur && cur.parentId && i < 64; i++) {
      const pid = cur.parentId;
      if (R.handed?.has(pid)) { (R.handed ||= new Set()).add(id); return true; }
      const po = this.owner.get(pid);
      if (po && po !== R.sid) {
        const P = this.roots.get(po);
        if (P && P.rt?.inheritedFrom?.has?.(R.sid)) { (R.handed ||= new Set()).add(id); return true; }
        return false;
      }
      cur = g.get(pid);
    }
    return false;
  }

  /** 옛 루트 P 에서 id 와 그 자손(P 소유)을 걷는다 — node-remove 한 번, 소유권 해제 */
  _handOver(P, id) {
    const g = P.rt.graph;
    const ids = [];
    for (const nid of g.order) {
      if (this.owner.get(nid) !== P.sid) continue;
      if (nid === id || g.isAncestor(id, nid)) ids.push(nid);
    }
    P.handed ||= new Set();
    for (const nid of ids) { this.owner.delete(nid); P.ids.delete(nid); P.handed.add(nid); }
    P.handed.add(id);
    if (ids.length) {
      this._push({ seq: ++this.hseq, ts: new Date().toISOString(), type: 'node-remove', nodeId: id, subtree: true, ids: ids.reverse(),
        projectId: P.projectId, rootSessionId: P.sid, handoff: true }, P.visible ? 'all' : 'inactive');
    }
  }

  /**
   * 옛 메인이 분리 실행으로 띄운 기동기(최상위, meta.spawnedBy = 옛 메인)가 아직 살아 있고 새 메인 루트가 있으면
   * 그 기동기는 새 메인 옆에 그린다(spawnedBy = 새 메인, inheritedFrom = 옛 sid). 회차 매칭·트리는 옛 런타임 그대로
   */
  _handoffMeta(R, node) {
    if (!node || node.parentId || node.kind !== 'bash-bg' || !node.meta?.launcher) return null;
    if (node.status === 'done' || node.status === 'error' || node.status === 'stopped') return null;
    if (node.meta.spawnedBy !== R.rootNodeId) return null;
    const S = this._successorOf(R.sid);
    return S ? { spawnedBy: S.rootNodeId, inheritedFrom: R.sid } : null;
  }

  _hasLiveHandoff(R) {
    if (!this._successorOf(R.sid)) return false;
    for (const id of R.ids) if (this._handoffMeta(R, R.rt.graph.get(id))) return true;
    return false;
  }

  /** 새 메인 루트가 붙었을 때: 그 루트가 이어받은 옛 루트들의 살아 있는 기동기 자리를 새 메인 옆으로 */
  _announceHandoff(S) {
    if (!S.rt?.inheritedFrom?.size) return;
    for (const P of this.roots.values()) {
      if (P === S || !S.rt.inheritedFrom.has(P.sid)) continue;
      for (const id of P.ids) {
        if (this.owner.get(id) !== P.sid) continue;
        const m = this._handoffMeta(P, P.rt.graph.get(id));
        if (m) this._emit(P, { ts: new Date().toISOString(), type: 'node-update', nodeId: id, patch: { meta: m } });
      }
    }
  }

  /** 소유권이 풀린 id 를, 같은 노드를 가진 다른 루트가 이어서 내보낸다(먼저 붙은 루트가 빠지면 뒤 루트의 같은 노드가 사라지던 문제) */
  _reoffer(freed) {
    if (!freed.size) return;
    const ts = new Date().toISOString();
    for (const R of this.roots.values()) {
      const g = R.rt.graph;
      for (const id of g.order) {
        if (!freed.has(id) || this.owner.has(id)) continue;
        const node = g.nodes.get(id);
        if (!node || !this._claim(R, id)) continue;
        this._emit(R, { ts, type: 'node-add', nodeId: id, node: structuredClone(node) });
      }
    }
  }

  _onRootEvent(R, e) {
    if (this.roots.get(R.sid) !== R) return;
    if (e.type === 'node-add') { if (!this._claim(R, e.nodeId)) return; }
    else if (this.owner.get(e.nodeId) !== R.sid) return;
    this._emit(R, e);
    if (e.type === 'tool-start') this._sessionTouch(R, e);
  }

  // ───────────── 같은 파일 충돌·세션 간 메시지 ─────────────

  /** 충돌 그룹 = 지금 live 인 메인 루트(독립 claude -p·기동기 루트 아님) */
  _isGroup(R) { return !!(R && R.meta.live && !R.orphanSdk); }
  _confGroups() { const s = new Map(); for (const m of this.conf.files.values()) for (const g of m.keys()) s.set(g, true); return s; }
  _mainOf(sid) { const R = this.roots.get(sid); return R ? R.rootNodeId : `s:${sid}`; }

  _confOut(r) {
    if (!r) return;
    const ts = new Date().toISOString();
    for (const c of r.off) this._pushHub(conflictEvent(c, 'off', ts, (g) => this._mainOf(g)), c);
    for (const c of r.on) this._pushHub(conflictEvent(c, 'on', ts, (g) => this._mainOf(g)), c);
  }
  _pushHub(ev, c) {
    const R = this.roots.get(c ? c.a : null);
    this._push({ seq: ++this.hseq, ...ev, projectId: R ? R.projectId : null }, 'all');
  }

  _sessionTouch(R, e) {
    if (!this._isGroup(R)) return;
    if (e.file) for (const f of fileList(e)) this._confOut(this.conf.touch(R.sid, f, Date.parse(e.ts) || Date.now(), e.nodeId));
    if (e.to) {
      let target = null;
      for (const id of [`a:${e.to}`, `s:${e.to}`, e.to]) if (this.owner.has(id)) { target = id; break; }
      const osid = target ? this.owner.get(target) : null;
      const O = osid && this.roots.get(osid);
      if (!O || O === R || !this._isGroup(O)) return;
      this._push({ seq: ++this.hseq, ...sessionMsgEvent({ ts: e.ts, fromMain: R.rootNodeId, toMain: O.rootNodeId, fromNode: e.nodeId, toNode: target, text: e.brief || e.text }),
        projectId: R.projectId, rootSessionId: R.sid }, 'all');
    }
  }

  /** 서브트리 제거 이벤트 + 소유권 해제 + unpin */
  _removeRoot(R, opts = {}) {
    const ids = [...R.ids].filter((id) => this.owner.get(id) === R.sid).reverse();
    if (ids.length) {
      this._push({ seq: ++this.hseq, ts: new Date().toISOString(), type: 'node-remove', nodeId: R.rootNodeId, subtree: true, ids,
        projectId: R.projectId, rootSessionId: R.sid }, R.visible ? 'all' : 'inactive');
    }
    this._drop(R, opts);
  }

  _drop(R, { reoffer = true } = {}) {
    const freed = new Set();
    for (const id of R.ids) if (this.owner.get(id) === R.sid) { this.owner.delete(id); freed.add(id); }
    try { R.unsub?.(); } catch {}
    this.roots.delete(R.sid);
    try { this.source.release(R.sid); } catch {}
    if (reoffer && this.awake && !this.stopped) this._reoffer(freed);
  }

  _setMeta(R, m) {
    const patch = {};
    for (const [k, v] of Object.entries(m)) if (R.meta[k] !== v) { R.meta[k] = v; patch[k] = v; }
    if (!Object.keys(patch).length || !R.ids.has(R.rootNodeId)) return;
    this._push(this._annot(R, { seq: 0, ts: new Date().toISOString(), type: 'node-update', nodeId: R.rootNodeId, patch: { meta: patch } }),
      R.visible ? 'all' : 'inactive');
  }

  /** 기본(inactive=0) 구독자에게만 보이고/숨기는 전환 */
  _setVisible(R, v) {
    if (R.visible === v) return;
    R.visible = v;
    const ids = [...R.ids].filter((id) => this.owner.get(id) === R.sid);
    if (!ids.length) return;
    if (!v) {
      this._push({ seq: ++this.hseq, ts: new Date().toISOString(), type: 'node-remove', nodeId: R.rootNodeId, subtree: true,
        ids: ids.reverse(), projectId: R.projectId, rootSessionId: R.sid }, 'default');
    } else {
      const ts = new Date().toISOString();
      for (const id of R.rt.graph.order) {
        if (this.owner.get(id) !== R.sid) continue;
        const node = R.rt.graph.nodes.get(id);
        if (node) this._push(this._annot(R, { seq: 0, ts, type: 'node-add', nodeId: id, node: structuredClone(node) }), 'default');
      }
    }
  }

  // ───────────── 이벤트 ─────────────

  _annot(R, e) {
    const out = { ...e, seq: ++this.hseq, projectId: R.projectId, rootSessionId: R.sid };
    if (e.node) {
      const node = { ...e.node, projectId: R.projectId, rootSessionId: R.sid };
      if (e.node.id === R.rootNodeId) node.meta = { ...(e.node.meta || {}), ...R.meta };
      const hm = this._handoffMeta(R, e.node);
      if (hm) node.meta = { ...(node.meta || {}), ...hm };
      out.node = node;
    }
    return out;
  }

  _emit(R, e) { this._push(this._annot(R, e), R.visible ? 'all' : 'inactive'); }

  _push(ev, aud) {
    this.ring.push({ ev, aud });
    if (this.ring.length > RING_MAX) this.ring.splice(0, this.ring.length - RING_MAX);
    this.stats.emitted++;
    for (const s of this.subs) {
      if (!audOk(aud, s.inactive)) continue;
      try { s.onEvent?.(ev); } catch {}
    }
  }

  /** since 다음 이벤트(구독자 범위로 거름). 링 밖이면 null */
  eventsSince(since, { inactive = false } = {}) {
    if (!Number.isFinite(since) || since < 0 || since > this.hseq) return null;
    if (!this.ring.length) return since === this.hseq ? [] : null;
    if (since < this.ring[0].ev.seq - 1) return null;
    return this.ring.filter((x) => x.ev.seq > since && audOk(x.aud, inactive)).map((x) => x.ev);
  }

  _rootsFor(inactive) {
    return [...this.roots.values()].filter((R) => inactive || R.visible);
  }

  rootsPayload(inactive = false) {
    return this._rootsFor(inactive).map((R) => ({ sessionId: R.sid, projectId: R.projectId, nodeId: R.rootNodeId,
      live: R.meta.live, liveStatus: R.meta.liveStatus, tier: R.meta.tier, ...(R.orphanSdk ? { orphanSdk: true } : {}) }));
  }

  /** /state?scope=all 형식 */
  snapshot({ inactive = false } = {}) {
    const nodes = [];
    const recent = [];
    for (const R of this._rootsFor(inactive)) {
      const g = R.rt.graph;
      for (const id of g.order) {
        if (this.owner.get(id) !== R.sid) continue;
        const n = g.nodes.get(id);
        if (!n) continue;
        const node = { ...n, projectId: R.projectId, rootSessionId: R.sid };
        if (id === R.rootNodeId) node.meta = { ...n.meta, ...R.meta };
        const hm = this._handoffMeta(R, n);
        if (hm) node.meta = { ...node.meta, ...hm };
        nodes.push(node);
      }
      for (const e of g.ring.slice(-RECENT_MAX)) {
        if (this.owner.get(e.nodeId) !== R.sid) continue;
        recent.push({ ...e, seq: 0, projectId: R.projectId, rootSessionId: R.sid });
      }
    }
    recent.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0));
    return {
      scope: 'all', root: null, seq: this.hseq, nodes,
      recent: recent.slice(-RECENT_MAX).map((e) => (e.node ? { ...e, node: { ...e.node, projectId: e.projectId, rootSessionId: e.rootSessionId } } : e)),
      projects: this.projectsState.projects, roots: this.rootsPayload(inactive),
      conflicts: this.conf.list().map((c) => conflictEvent(c, 'on', new Date().toISOString(), (g) => this._mainOf(g))),
    };
  }

  /** 허브가 지금 붙든 루트·자식 소유 정보(/projects 의 inOverview 계산용) */
  info() {
    if (!this.awake) return null;
    return {
      roots: new Set([...this.roots.values()].filter((R) => R.visible).map((R) => R.sid)),
      rootOf: (sid) => this.owner.get(`s:${sid}`) || null,
    };
  }

  async _refreshProjects(want) {
    let projects;
    try { projects = await this.source.projects({ overview: this.info(), want }); } catch (e) { log('projects', e?.message || e); return; }
    const key = JSON.stringify([projects, this.rootsPayload(false), this.rootsPayload(true)]);
    if (key === this.projectsState.json) return;
    const now = Date.now();
    this.projectsState.projects = projects;
    this.projectsState.json = key;
    if (now - this.projectsState.at < this.projectsMinMs && this.projectsState.at) {
      // 최소 5초 간격: 다음 tick 에서 다시 비교해 보낸다
      this.projectsState.json = '';
      return;
    }
    this.projectsState.at = now;
    for (const s of this.subs) {
      try { s.onProjects?.({ projects, roots: this.rootsPayload(s.inactive) }); } catch {}
    }
  }
}

const audOk = (aud, inactive) => aud === 'all' || (inactive ? aud === 'inactive' : aud === 'default');

// ───────────── 실제 파일 기반 공급자 ─────────────

/**
 * RootManager + SessionIndex 로 루트 공급자를 만든다.
 * live cli 메인 전부(최대 maxRoots, 활동 시각 순) + 기동기 회차가 붙든 메인 + 매칭 안 된 live sdk-cli(합 최대 maxWithInactive).
 * 끝난 지 오래된(recent·inactive) 메인은 싣지 않는다 — 예전 '비활성 표시'(inactive=1) 구독은 없앴다
 */
export function createRealSource({ manager, index, maxRoots = 12, maxWithInactive = 16 }) {
  return {
    async desired() {
      if (Date.now() - (index.lastRefresh || 0) > 4000) await index.refresh();
      const mains = [], sdk = [];
      for (const p of index.liveProcs()) {
        const e = p.entry;
        if (index.project && e.projectDir !== index.project) continue;
        if (index.claimedChildren.has(p.sessionId)) continue;
        const h = await index.ensureHead(e);
        const ep = p.entrypoint || h.entrypoint;
        const act = await cachedActivity(index, e);
        const r = { sessionId: p.sessionId, projectId: e.projectDir, live: true, liveStatus: p.status ?? null, tier: 'live',
          entrypoint: ep, orphanSdk: ep === 'sdk-cli', activityMs: act };
        (ep === 'sdk-cli' ? sdk : mains).push(r);
      }
      mains.sort((a, b) => b.activityMs - a.activityMs);
      const roots = mains.slice(0, maxRoots);
      const overflow = new Set(mains.slice(maxRoots).map((r) => r.sessionId));
      // 살아 있는 sdk-cli(이미 붙은 것 포함)가 기동기 회차로 판정되면, 그 기동 명령이 있던 세션(이미 끝났어도)을
      // 루트로 붙든다. 그 런타임이 회차를 기동기 아래로 가져가면(claimed) 독립 루트 후보에서 빠진다(그 사이 orphanDelay 30초)
      const have = new Set(roots.map((r) => r.sessionId));
      const li = launcherIndexOf(index);
      for (const p of index.liveProcs()) {
        if (roots.length >= maxWithInactive) break;
        if (index.project && p.entry.projectDir !== index.project) continue;
        if ((p.entrypoint || (await index.ensureHead(p.entry)).entrypoint) !== 'sdk-cli') continue;
        let a = null;
        try { a = await li.assign(p.entry); } catch {}
        const r0 = sdk.find((x) => x.sessionId === p.sessionId);
        if (r0 && a && a.none) {
          // 붙이지 못한 회차: 같은 프로젝트의 살아 있는 메인을 '추정 소속'으로만 싣는다(트리는 바꾸지 않음)
          const m = mains.find((x) => x.projectId === r0.projectId);
          r0.likelyMain = m ? m.sessionId : null;
          r0.unlinkedReason = a.none;
        }
        const psid = a && !a.none ? (a.adopter || a.sessionId) : null; // 인계면 이어받은 메인
        const pe = psid ? index.findSession(psid) : null;
        if (!pe || have.has(psid) || !(await index.isCandidate(pe))) continue;
        have.add(psid);
        const live = index.liveProcs().some((x) => x.sessionId === psid);
        roots.push({ sessionId: psid, projectId: pe.projectDir, live, liveStatus: null, tier: live ? 'live' : 'recent', entrypoint: 'cli',
          orphanSdk: false, activityMs: pe.mtimeMs, launcherOf: p.sessionId });
      }
      for (const r of sdk) if (roots.length < maxWithInactive) roots.push(r);
      return { roots, overflow };
    },
    acquire: (sid) => manager.pin(sid),
    release: (sid) => manager.unpin(sid),
    async projects({ overview } = {}) {
      return (await buildProjects(index, { overview, maxRoots })).projects;
    },
  };
}
