// 루트 런타임 LRU(최대 3개)와 follow=auto 선택
import { RootRuntime } from './session.mjs';
import { ReplayCache } from './replay.mjs';

export class RootManager {
  constructor({ index, privacy = 'summary', maxRoots = 3, maxDepth = 8, replayCacheMax = 2 }) {
    this.index = index;
    this.replays = new ReplayCache({ index, privacy, max: replayCacheMax, maxDepth });
    this.privacy = privacy;
    this.maxRoots = maxRoots;
    this.maxDepth = maxDepth;
    this.roots = new Map(); // sessionId → RootRuntime
    this.pinned = new Map(); // 3차: sessionId → RootRuntime. LRU 계산에서 빠짐
    this.autoSid = null;
    this.autoListeners = new Set();
    this.timer = null;
  }

  startAutoWatch(intervalMs = 5000) {
    this.timer = setInterval(async () => {
      try {
        await this.index.refresh();
        const sid = await this.index.autoPick();
        if (sid && sid !== this.autoSid) {
          const prev = this.autoSid;
          this.autoSid = sid;
          if (prev) for (const fn of this.autoListeners) { try { fn(sid); } catch {} }
        }
      } catch {}
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.hub?.stop?.();
    this.pinned.clear();
    for (const rt of this.roots.values()) rt.close();
    this.roots.clear();
  }

  onAuto(fn) { this.autoListeners.add(fn); return () => this.autoListeners.delete(fn); }

  async resolve(param) {
    if (!param || param === 'auto') {
      const sid = await this.index.autoPick();
      if (sid && !this.autoSid) this.autoSid = sid;
      return this.autoSid || sid;
    }
    return String(param).toLowerCase();
  }

  /** 런타임을 얻는다(필요하면 만들고 초기 로드). refs 를 올린다. */
  async acquire(sessionId) {
    let rt = this.roots.get(sessionId);
    if (!rt) {
      rt = new RootRuntime({ sessionId, index: this.index, privacy: this.privacy, maxDepth: this.maxDepth });
      this.roots.set(sessionId, rt);
      this._evict(sessionId);
    }
    rt.refs++;
    rt.lastUsed = Date.now();
    try {
      await rt.start();
    } catch (e) {
      rt.refs--;
      rt.close();
      if (this.roots.get(sessionId) === rt) this.roots.delete(sessionId);
      throw e;
    }
    return rt;
  }

  release(rt) {
    if (!rt) return;
    rt.refs = Math.max(0, rt.refs - 1);
    rt.lastUsed = Date.now();
  }

  /** 3차: 전체 보기 허브가 루트를 붙든다. LRU(maxRoots) 와 별도로 세며 evict 대상이 아니다 */
  async pin(sessionId) {
    const sid = String(sessionId).toLowerCase();
    if (this.pinned.has(sid)) return this.pinned.get(sid);
    const rt = await this.acquire(sid);
    if (this.pinned.has(sid)) { this.release(rt); return this.pinned.get(sid); }
    this.pinned.set(sid, rt);
    return rt;
  }

  /** 고정 해제: 참조를 돌려주고 LRU 로 돌아간다(넘치면 오래된 것부터 정리) */
  unpin(sessionId) {
    const sid = String(sessionId).toLowerCase();
    const rt = this.pinned.get(sid);
    if (!rt) return;
    this.pinned.delete(sid);
    this.release(rt);
    this._evict(null);
  }

  /** 일시 조회(/state): 획득 후 바로 반납 */
  async peek(sessionId) {
    const rt = await this.acquire(sessionId);
    this.release(rt);
    return rt;
  }

  /** 재생 데이터. ReplayData 또는 {building:true, progress} */
  replay(sid, { refresh = false, wait = true, waitMs } = {}) {
    return this.replays.get(sid, { refresh, wait, waitMs });
  }

  /** 이미 만들어진 재생 데이터만(없으면 null) */
  replayPeek(sid) { return this.replays.peek(sid); }

  /** 세션이 속한 프로젝트 폴더 이름(없으면 null) */
  async projectOf(sid) {
    let e = this.index.findSession(sid);
    if (!e) { await this.index.refresh(); e = this.index.findSession(sid); }
    return e ? e.projectDir : null;
  }

  _evict(keep) {
    // 고정(pin)된 런타임은 LRU 개수에 넣지 않는다. 고정이 없으면 1·2차와 같다
    const count = () => this.roots.size - [...this.pinned.keys()].filter((s) => this.roots.has(s)).length;
    if (count() <= this.maxRoots) return;
    const idle = [...this.roots.entries()].filter(([sid, rt]) => sid !== keep && rt.refs === 0 && !this.pinned.has(sid))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (count() > this.maxRoots && idle.length) {
      const [sid, rt] = idle.shift();
      rt.close();
      this.roots.delete(sid);
    }
  }
}
