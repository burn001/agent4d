// 복셀 오피스 여러 live 세션 연출의 순수 부분 — three·DOM 없음. 3D(vx-sessions.js)·2D 평면도(flat/voxel2d.js)가 같이 쓴다.
//  · 사무실 이사 보간(translateOffice 로 방·자리·기계를 같이 옮김)
//  · 같은 파일 충돌 → 양쪽 직원 캐비닛 방문(ch.visit), 라운지 찾기
//  · 세션 간 메시지 → 종이비행기 목록
import { t as _t } from '../i18n.mjs';
import { translateOffice } from './campus.mjs';
import { conflictPairs } from '../conflict-core.mjs';
import { sessionColorMap, nodeSessIdx } from '../multi-core.mjs';

export const MOVE_DUR = 1.2;      // 이사 보간(초)
export const VISIT_SEC = 8;       // 충돌 때 캐비닛 앞에 서 있는 시간
export const PLANE_DUR = 2.2;

export const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const originOf = (lay) => (lay && lay.rooms && lay.rooms[0] ? { x: lay.rooms[0].origin.x, z: lay.rooms[0].origin.z } : null);

export class VxSessCore {
  constructor(view) {
    this.view = view;
    this.book = null;
    this.colors = new Map();
    this.moves = new Map();   // mainId → {fx, fz(남은 오프셋 시작값), t0, ax, az(지금 적용된 오프셋)}
    this.shown = new Map();   // mainId → 지금 화면 자리(첫 방 origin)
    this.planes = [];
    this.seen = new Map();    // 충돌 묶음 id → 마지막으로 본 강약·파일 열쇠(새로 생기거나 바뀌면 직원이 캐비닛으로)
    this.cabs = [];           // 캐비닛 말풍선 CSS2D 풀
    this.pairs = [];
  }

  setBook(book) { this.book = book; }
  setProjects(projects, mode) { this.colors = mode === 'all' ? sessionColorMap(projects) : new Map(); }
  sessIdx(n) { return nodeSessIdx(n, this.colors); }
  sessColor(n) { const i = this.sessIdx(n); return i == null ? null : this.view.tokens['sess-' + i]; }

  // ---------------- 사무실 이사(보간) ----------------
  /** _relayout 직후: 새 배치(최종 자리)에서 옮겨 간 사무실을 이전 화면 자리로 되돌려 놓고 보간을 건다. 움직이는 방 id 집합 */
  afterLayout(lay, now) {
    const moving = new Set();
    if (!lay || !lay.officeByMain) { this.moves.clear(); this.shown.clear(); return moving; }
    const next = new Map();
    for (const [mid, off] of lay.officeByMain) {
      const o = originOf(off);
      if (!o) continue;
      let m = this.moves.get(mid);
      const prev = this.shown.get(mid);
      if (m) {
        // 보간 중: 남은 오프셋을 다시 적용(배치가 다시 계산돼도 이어서)
        const k = Math.min(1, (now - m.t0) / MOVE_DUR), f = 1 - ease(k);
        m.ax = m.fx * f; m.az = m.fz * f;
        translateOffice(off, m.ax, m.az);
      } else if (prev && Math.hypot(prev.x - o.x, prev.z - o.z) > 2 && this.view.scope.mode === 'all') {
        m = { fx: prev.x - o.x, fz: prev.z - o.z, t0: now, ax: prev.x - o.x, az: prev.z - o.z };
        this.moves.set(mid, m);
        translateOffice(off, m.ax, m.az);
      }
      if (m) for (const r of off.rooms) moving.add(r.id);
      const s = originOf(off);
      next.set(mid, s);
    }
    for (const mid of [...this.moves.keys()]) if (!lay.officeByMain.has(mid)) this.moves.delete(mid);
    this.shown = next;
    return moving;
  }

  /** 매 프레임: 보간 진행(방·자리·기계를 같이 옮김). 움직였으면 true(정적 다시 그림) */
  stepMoves(now) {
    const lay = this.view.layout;
    if (!this.moves.size || !lay || !lay.officeByMain) return false;
    let any = false;
    for (const [mid, m] of [...this.moves]) {
      const off = lay.officeByMain.get(mid);
      if (!off) { this.moves.delete(mid); continue; }
      const k = Math.min(1, (now - m.t0) / MOVE_DUR), f = 1 - ease(k);
      const nx = m.fx * f, nz = m.fz * f;
      if (Math.abs(nx - m.ax) > 1e-4 || Math.abs(nz - m.az) > 1e-4) {
        translateOffice(off, nx - m.ax, nz - m.az);
        m.ax = nx; m.az = nz; any = true;
      }
      if (k >= 1) this.moves.delete(mid);
      const s = originOf(off); if (s) this.shown.set(mid, s);
    }
    return any;
  }

  // ---------------- 충돌·방문 ----------------
  /** 매 프레임: 충돌 묶음을 읽고, 새로 생기거나 바뀐 묶음이면 양쪽 직원을 캐비닛 앞으로 */
  stepConflicts(now) {
    const v = this.view, lay = v.layout;
    this.pairs = this.book ? conflictPairs(this.book.items(Date.now())) : [];
    if (!lay || !lay.lounges || !lay.lounges.length) return;
    const keep = new Set();
    for (const p of this.pairs) {
      keep.add(p.id);
      const key = p.level + '|' + p.files.join(',') + '|' + (p.fading ? 'f' : '');
      if (p.fading || this.seen.get(p.id) === key) continue;
      this.seen.set(p.id, key);
      const lg = this.loungeOf(p);
      if (!lg) continue;
      const who = [this._char(p.nodeA, p.a), this._char(p.nodeB, p.b)];
      // 캐비닛 앞 자리: 다른 충돌로 와 있는 직원이 쓰는 자리는 건너뛰고 빈 자리부터(예전엔 늘 0·1번 → 두 묶음이 같은 점). 다 차면 자리에서
      const used = new Set();
      for (const o of v.chars.values()) if (o.visit && o.visit.until > now && o.visit.lounge === lg.id && !who.includes(o)) used.add(o.visit.idx);
      const until = now + VISIT_SEC / Math.max(1, Math.sqrt(v.ts || 1));
      for (const ch of who) {
        if (!ch) continue;
        let i = ch.visit && ch.visit.until > now && ch.visit.lounge === lg.id && !used.has(ch.visit.idx) ? ch.visit.idx : -1;
        if (i < 0) { i = 0; while (i < lg.spots.length && used.has(i)) i++; }
        if (i >= lg.spots.length) continue;
        used.add(i);
        ch.visit = { spot: lg.spots[i], until, lounge: lg.id, idx: i };
      }
    }
    for (const id of [...this.seen.keys()]) if (!keep.has(id)) this.seen.delete(id);
  }
  /** 충돌 두 메인이 같은 동 라운지에 있으면 그 라운지 */
  loungeOf(p) {
    const lay = this.view.layout;
    for (const g of lay.lounges || []) if (g.mains.includes(p.a) && g.mains.includes(p.b)) return g;
    for (const g of lay.lounges || []) if (g.mains.includes(p.a) || g.mains.includes(p.b)) return g;
    return null;
  }
  /** 파일을 건드린 노드의 캐릭터(없거나 나갔으면 그 세션 팀장) */
  _char(nodeId, mainId) {
    const v = this.view;
    for (const id of [nodeId, mainId]) {
      const ch = id && v.chars.get(id);
      if (ch && ch.state !== 'gone' && ch.state !== 'leave' && ch.placed && !ch.offstage && ch.room) return ch;
    }
    return null;
  }

  // ---------------- 메시지 ----------------
  message(ev, now) {
    const v = this.view;
    const a = v.chars.get(ev.nodeId), b = v.chars.get(ev.peer);
    if (!a || !b || !a.placed || !b.placed) return false;
    this.planes.push({ from: ev.nodeId, to: ev.peer, t0: now, color: this.sessColor(a.node) || v.tokens['flow-call'] || v.tokens.ok });
    if (this.planes.length > 16) this.planes.shift();
    return true;
  }
  /** 날고 있는 비행기만 남김 */
  livePlanes(now) { this.planes = this.planes.filter((p) => now - p.t0 < PLANE_DUR); return this.planes; }
  /** 동(라운지)별 충돌 묶음 */
  pairsOf(g) { return this.pairs.filter((p) => this.loungeOf(p) === g); }
  /** 캐비닛 말풍선 글 */
  cabText(ps) { const files = [...new Set(ps.flatMap((p) => p.files))]; return files.length > 1 ? _t('scene.cab.more', { file: files[0], n: files.length - 1 }) : files[0] || ''; }
}
