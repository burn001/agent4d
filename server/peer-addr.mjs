// 수신함 주소 장부 — 교차 세션 메시지의 답장 주소(origin.from 'uds:<파이프·소켓>') → 보낸 세션 id.
// 라이브에서는 세션 기록(~/.claude/sessions/<pid>.json 의 messagingSocketPath)으로 바로 찾지만, 그 기록은 프로세스가 끝나면 지워진다.
// 그래서 서버가 세션 목록을 훑을 때(SessionIndex._refreshLive · peerNodeOf) 본 주소 ↔ 세션 짝을 이 장부에 적어 두고,
// 재생·보관함 재생(RootRuntime offline)은 이 장부로만 찾는다. 주소는 프로세스마다 새로 뽑히는 무작위 이름이라 짝이 겹치지 않는다.
// 파일: <상태 폴더>/peer-addr.json {v:1, m:{<정규 주소>: [sessionId, 마지막으로 본 ms]}} — 주소·세션 id 뿐(열쇠·이름·글 없음), 0600, 상한 MAX.
import fs from 'node:fs';
import path from 'node:path';
import { ccvizHome } from './home.mjs';
import { canonicalAddr } from './interact-peer.mjs';

export const PEER_ADDR = { MAX: 2000, SAVE_MS: 15_000, FILE: 'peer-addr.json' };
const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 'uds:<주소>' 또는 맨 주소 → 정규 주소(파이프는 소문자, 소켓은 path.resolve) | null */
export function addrKey(x) {
  if (typeof x !== 'string' || !x) return null;
  const a = x.startsWith('uds:') ? x.slice(4) : x;
  return canonicalAddr(a) || null;
}

export class PeerAddrBook {
  /** file: null 이면 메모리만(시험·데모) */
  constructor({ file = path.join(ccvizHome(), PEER_ADDR.FILE), max = PEER_ADDR.MAX, now = Date.now, log = () => {} } = {}) {
    this.file = file; this.max = max; this.now = now; this.log = log;
    this.m = new Map(); // 정규 주소 → [sid, at]
    this._mtime = -1; this._dirty = false; this._timer = null;
  }
  _load() {
    if (!this.file) return;
    let st; try { st = fs.statSync(this.file); } catch { return; }
    if (st.mtimeMs === this._mtime) return;
    this._mtime = st.mtimeMs;
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries((j && j.m) || {})) {
        if (!Array.isArray(v) || !SID_RE.test(String(v[0])) || typeof k !== 'string' || k.length > 300) continue;
        const cur = this.m.get(k);
        if (!cur || (v[1] || 0) > cur[1]) this.m.set(k, [String(v[0]), Number(v[1]) || 0]);
      }
      this._trim();
    } catch {}
  }
  _trim() {
    if (this.m.size <= this.max) return;
    const arr = [...this.m.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, this.max);
    this.m = new Map(arr);
  }
  /** 주소 → 세션 id | null */
  get(addr) {
    const k = addrKey(addr);
    if (!k) return null;
    if (!this.m.has(k)) this._load();
    const v = this.m.get(k);
    return v ? v[0] : null;
  }
  /** 본 짝들 [[주소, sessionId], …] 적기(바뀐 것이 있으면 늦춰 저장) */
  observe(pairs) {
    const t = this.now();
    let changed = false;
    for (const [addr, sid0] of pairs || []) {
      const k = addrKey(addr), sid = String(sid0 || '').toLowerCase();
      if (!k || !SID_RE.test(sid)) continue;
      const cur = this.m.get(k);
      if (cur && cur[0] === sid) { if (t - cur[1] > 3600_000) cur[1] = t; continue; } // 같은 짝은 시각만(한 시간에 한 번, 저장 안 함)
      this.m.set(k, [sid, t]); changed = true;
    }
    if (changed) { this._trim(); this._schedule(); }
    return changed;
  }
  _schedule() {
    if (!this.file) return;
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, PEER_ADDR.SAVE_MS);
    this._timer.unref?.();
  }
  /** 지금 저장(다른 서버가 쓴 짝과 합침). 실패는 로그만 */
  flush() {
    if (!this.file || !this._dirty) return;
    this._dirty = false;
    try {
      const mine = this.m; this.m = new Map(); this._mtime = -1; this._load(); // 파일 쪽 짝 먼저
      for (const [k, v] of mine) { const cur = this.m.get(k); if (!cur || v[1] >= cur[1]) this.m.set(k, v); }
      this._trim();
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, m: Object.fromEntries(this.m) }), { mode: 0o600 });
      try { fs.renameSync(tmp, this.file); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      try { this._mtime = fs.statSync(this.file).mtimeMs; } catch {}
    } catch (e) { this.log(`[ccviz] peer-addr save failed: ${e?.code || e?.message}`); }
  }
  close() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } this.flush(); }
}

let _shared = null;
/** 서버·CLI 공용 장부(상태 폴더 파일) */
export function sharedPeerAddrBook() { if (!_shared) _shared = new PeerAddrBook(); return _shared; }
/** 시험용: 공용 장부 바꿔 끼우기(null = 다음에 새로) */
export function _setSharedPeerAddrBook(b) { _shared = b; }
