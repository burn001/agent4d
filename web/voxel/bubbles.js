// 말풍선·이름표·방 문패 — CSS2D. DOM 은 미리 만든 풀을 돌려 쓴다(프레임마다 생성 0).
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { placeLabelsBoard, textWidth as textPx } from '../label-place.mjs';
import { planLabelRects } from '../plan-core.mjs'; // 계획 보드 = 라벨의 고정 장애물
import { QUIP, rankQuips } from './quip-core.mjs'; // 생각·말풍선

const VX_SHIFTS = [0, 14, 28], VX_FAR = [42, [0.6, 14], [-0.6, 14], 56, [0.6, 42], [-0.6, 42], 70];

const BUBBLE_MAX = 8, BUBBLE_MAX_NARROW = 4;
const LABEL_MAX = 24;
const ROOM_MAX = 16;
const trunc = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

class Pool {
  constructor(scene, cls, n, center = [0.5, 1], wrap = false) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      // wrap: 바깥 div 는 CSS2DRenderer 가 transform 으로 옮기고, 안쪽 div 를 겹침 해소용으로 따로 올린다
      const outer = document.createElement('div');
      let el = outer;
      if (wrap) { outer.className = 'vx-anchor' + (cls === 'vx-label' ? ' vx-lanchor' : ''); el = document.createElement('div'); outer.appendChild(el); }
      el.className = cls;
      const o = new CSS2DObject(outer);
      o.center.set(center[0], center[1]);
      o.visible = false;
      scene.add(o);
      this.items.push({ o, el, outer, key: null, html: '', cls: '', off: 0, sx: 0, sy: 0, w: 0 });
    }
  }
  dispose() { for (const it of this.items) { it.o.removeFromParent(); it.outer.remove(); } this.items = []; }
}

export class Bubbles {
  constructor(scene) {
    this.scene = scene;
    this.bubbles = new Map();   // nodeId → {text, type, until, born}
    this.bpool = new Pool(scene, 'vx-bubble', BUBBLE_MAX, [0.5, 1], true);
    this._v = null;
    this.lpool = new Pool(scene, 'vx-label', LABEL_MAX, [0.5, 0], true); // 안쪽 div 를 라벨 배치 밀기에 씀
    this.rpool = new Pool(scene, 'vx-room', ROOM_MAX, [0, 0.5]);
  }

  /** 말풍선 하나(캐릭터당 1개, 새것이 덮음). type 'q-think'|'q-say' = 생각·말풍선(pri = 중요도 0～2) */
  say(id, text, { type = 'text', dur = 2.5, now, pri = 1 }) {
    const t = trunc(text, type === 'q-think' || type === 'q-say' ? 40 : 28);
    if (!t) return;
    this.bubbles.set(id, { text: t, type, until: now + dur, born: now, pri, pop: (this._pop = (this._pop || 0) + 1) & 1 });
  }

  clear() { this.bubbles.clear(); for (const p of [this.bpool, this.lpool, this.rpool]) for (const it of p.items) { it.o.visible = false; it.key = null; } }

  /**
   * ctx = { now, narrow, focusId, hoverId, posOf(id)→{x,y,z}|null, labels:[{id,text,cls,x,y,z}], rooms:[{id,text,cls,x,z}] }
   */
  update(ctx) {
    const { now } = ctx;
    // 말풍선: 만료 제거 → 포커스 > 최근 순으로 남김(생각·말풍선: 포커스 > 중요도 > 가까움 > 활동 > 최근, 멀면 숨김)
    const list = this._list || (this._list = []);
    list.length = 0;
    const cam = ctx.camera, quip = !!ctx.quips;
    const f = cam ? (ctx.height || 1) / (2 * Math.tan((cam.fov * Math.PI) / 360)) : 0;
    for (const [id, b] of this.bubbles) {
      if (now > b.until) { this.bubbles.delete(id); continue; }
      const p = ctx.posOf(id); // 공유 임시 객체 → 값만 복사
      if (!p) continue;
      const focus = id === ctx.focusId || id === ctx.hoverId;
      let dist = 0;
      if (quip && cam) {
        const dx = cam.position.x - p.x, dy = cam.position.y - p.y, dz = cam.position.z - p.z;
        dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!focus && (0.55 * f) / Math.max(0.01, dist) < QUIP.LOD_PX) continue; // 사람이 이보다 작게 보이면 풍선 숨김(LOD)
      }
      const e = b._e || (b._e = { id: null, b: null, x: 0, y: 0, z: 0, focus: false, pri: 0, dist: 0, born: 0, active: false });
      e.id = id; e.b = b; e.x = p.x; e.y = p.y; e.z = p.z; e.focus = focus; e.pri = b.pri || 0; e.dist = dist; e.born = b.born;
      e.active = !!(ctx.chars && ctx.chars.get(id) && ctx.chars.get(id).workCat);
      list.push(e);
    }
    if (quip) rankQuips(list);
    else list.sort((a, b) => ((b.id === ctx.focusId) - (a.id === ctx.focusId)) || (b.born - a.born));
    const max = quip ? (ctx.narrow ? QUIP.MAX_ON_NARROW : QUIP.MAX_ON) : ctx.narrow ? BUBBLE_MAX_NARROW : BUBBLE_MAX;
    const items = this.bpool.items;
    // 자리 고정: 이미 그 노드 풍선을 그리던 칸은 그대로(순위가 바뀔 때마다 칸을 바꿔 쓰면 className 이 바뀌어 등장 애니메이션이 모두 다시 돈다)
    const n = Math.min(max, list.length), order = this._order || (this._order = []);
    order.length = 0;
    const want = this._want || (this._want = new Map());
    want.clear();
    for (let i = 0; i < n; i++) want.set(list[i].id, list[i]);
    const free = this._free || (this._free = []);
    free.length = 0;
    for (const it of items) { if (it.key != null && want.has(it.key)) { it._e = want.get(it.key); want.delete(it.key); } else { it._e = null; free.push(it); } }
    for (const e of want.values()) { const it = free.shift(); if (it) it._e = e; }
    for (let i = 0; i < n; i++) for (const it of items) if (it._e === list[i]) { order.push(it); break; }
    for (const it of items) {
      const e = it._e;
      if (!e) { if (it.o.visible) it.o.visible = false; it.key = null; continue; }
      const { id, b } = e;
      const q = b.type === 'q-think' || b.type === 'q-say';
      const html = q ? '<span class="q-t">' + esc(b.text) + '</span>' + (b.type === 'q-think' ? '<i class="q-d"></i><i class="q-d q-d2"></i>' : '') : esc(b.text);
      const cls = (q ? 'vx-bubble ' + b.type + (b.pop ? ' qa' : ' qb') : 'vx-bubble t-' + b.type) + (id === ctx.focusId ? ' focus' : '') + (b.until - now < 0.35 ? ' out' : '');
      if (it.html !== html) { it.el.innerHTML = html; it.html = html; }
      if (it.cls !== cls) { it.el.className = cls; it.cls = cls; }
      it.o.position.set(e.x, e.y + 0.55, e.z);
      it.key = id;
      it.quip = q;
      it.w = textWidth(b.text) + (q ? 8 : 0);
      if (!it.o.visible) it.o.visible = true;
    }
    if (this._placed) this._placed.length = 0;
    if (ctx.camera) this._declutter(ctx, order);
    // 이름표
    fill(this.lpool, ctx.labels || [], (it, L) => { it.o.position.set(L.x, L.y, L.z); it.key = L.id; }, 'vx-label');
    fadePool(this.bpool, ctx); fadePool(this.lpool, ctx); // 프로젝트 페이드(사라진 동의 것은 숨겨 겹침 계산에서도 뺌)
    if (ctx.camera && ctx.labels) this._placeLabels(ctx, ctx.labels.length);
    // 방 문패
    fill(this.rpool, ctx.rooms || [], (it, R) => { it.o.position.set(R.x, R.y != null ? R.y : 0.05, R.z); }, 'vx-room');
    fadePool(this.rpool, ctx);
  }

  /** 이름표끼리·이름표와 다른 캐릭터가 겹치지 않게: 아래로 조금씩 밀고, 그래도 걸치면 흐리게(이름표는 모두 고정 라벨) */
  _placeLabels(ctx, n) {
    const W = ctx.width, H = ctx.height, cam = ctx.camera;
    const v = this._v || (this._v = cam.position.clone());
    const f = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const discs = [];
    for (const ch of ctx.chars ? ctx.chars.values() : []) {
      if (!ch.pos || ch.state === 'gone' || ch.offstage) continue;
      const d = Math.max(0.01, cam.position.distanceTo(v.set(ch.pos.x, 0.8, ch.pos.z))); // 몸 가운데
      v.project(cam);
      if (v.z < -1 || v.z > 1) continue;
      discs.push({ id: ch.id, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, r: (0.55 * f) / d });
    }
    const items = this.lpool.items, cands = [];
    for (let i = 0; i < n && i < items.length; i++) {
      const it = items[i];
      it._fitOn = null; // 이번 배치에 안 든 이름표는 예전 규칙(보이는지)으로
      if (!it.o.visible) continue;
      // 크기는 글이 바뀔 때 잰다. 아직 그려지지 않은(display:none) 이름표는 0 이라 추정만 쓰고 기억하지 않는다(— 예전엔 80px 로 굳어 겹침)
      if (it._mw == null || it._mwHtml !== it.html || !it._mwOk) {
        const w = it.el.offsetWidth, h = it.el.offsetHeight;
        it._mwOk = w > 0 && h > 0; it._mwHtml = it.html;
        it._mw = w || Math.max(80, textPx(it.el.textContent, 11) * 0.8); it._mh = h || 18;
      }
      v.copy(it.o.position).project(cam);
      if (v.z < -1 || v.z > 1) continue;
      cands.push({ id: it.key, i, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, up: false, gap: 0, force: / focus/.test(it.cls), pin: true, modes: [{ w: it._mw + 4, h: it._mh }] });
    }
    // 피할 사각형: 이번 프레임 말풍선 자리(_declutter 가 쌓은 상자)
    const rects = [];
    const pl = this._placed || [];
    for (let j = 0; j + 3 < pl.length; j += 4) rects.push([pl[j], pl[j + 1], pl[j + 2], pl[j + 3]]);
    // + 계획 보드(라벨이 비킴). 맞춤(fitLabels)은 보드를 뺀 배치로 — 보드 때문에 숨은 이름표가 맞춤에서 드나들지 않게
    const { placed, fit } = placeLabelsBoard(cands, discs, { shifts: VX_SHIFTS, farShifts: VX_FAR, bounds: [0, W], rects }, planLabelRects([]));
    for (const c of cands) {
      const it = items[c.i], r = placed.get(c.id);
      it._fitOn = fit.has(c.id);
      const dy = r ? r.dy : 0, dx = r ? r.dx : 0, dim = !r || r.dim;
      const off = dx + ',' + dy;
      if (it.off !== off) { it.off = off; it.el.style.transform = dy || dx ? `translate(${dx}px, ${dy}px)` : ''; }
      if (it.el.classList.contains('crowded') !== dim) it.el.classList.toggle('crowded', dim); // fill 이 className 을 다시 쓰면 빠지므로 매번 확인
      // 다른 이름표·말풍선과 겹치지 않는 자리가 아예 없으면(줄이고 쌓아도) 숨김 — 겹친 채 흐리게 남지 않게
      const vis = r ? '' : 'hidden';
      if (it.el.style.visibility !== vis) it.el.style.visibility = vis;
    }
  }

  /** 화면에서 겹치는 말풍선은 위로 쌓는다(우선순위 높은 것이 제자리) */
  _declutter(ctx, order) {
    const W = ctx.width, H = ctx.height, cam = ctx.camera;
    const placed = this._placed || (this._placed = []);
    placed.length = 0;
    const v = this._v || (this._v = cam.position.clone());
    for (const it of order) {
      v.copy(it.o.position).project(cam);
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      const w = it.w, h = it.quip ? 28 : 24;
      let off = 0, clash = false;
      // 생각·말풍선은 두 칸까지만 쌓고 그래도 겹치면 숨김(우선순위 낮은 쪽)
      const tries = it.quip ? 3 : 5;
      for (let k = 0; k < tries; k++) {
        const top = y - h - off, bot = y - off;
        let hit = false;
        for (let j = 0; j < placed.length; j += 4) {
          if (x - w / 2 < placed[j + 2] && x + w / 2 > placed[j] && top < placed[j + 3] && bot > placed[j + 1]) { hit = true; break; }
        }
        clash = hit;
        if (!hit) break;
        if (k < tries - 1) off += h + 3;
      }
      const vis = it.quip && clash ? 'hidden' : '';
      if (it.el.style.visibility !== vis) it.el.style.visibility = vis;
      if (vis) continue;
      placed.push(x - w / 2, y - h - off, x + w / 2, y - off);
      if (it.off !== off) { it.off = off; it.el.style.transform = off ? `translateY(${-off}px)` : ''; }
    }
  }

  /** 노드별 보이는 이름표: id → [{p: 세계 기준점, b: 기준점 기준 px 상자 {x0,x1,y0,y1}(y 아래)}] — 자동 카메라 전체 맞춤이 담는다.
   *  잠깐 뜨는 말풍선은 담지 않는다(뜰 때마다 줌이 드나들지 않게) */
  fitLabels(out) {
    for (const it of this.lpool.items) {
      if (!it.o.visible || !it.key || (it._fitOn != null ? !it._fitOn : it.el.style.visibility === 'hidden')) continue; // 보드를 뺀 배치 기준
      const w = (it._mw || 80) + 4, h = it._mh || 18, p = it.o.position;
      push(out, it.key, { p: { x: p.x, y: p.y, z: p.z }, b: { x0: -w / 2, x1: w / 2, y0: 0, y1: h + 6 } });
    }
    return out;
  }

  dispose() { this.bpool.dispose(); this.lpool.dispose(); this.rpool.dispose(); this.bubbles.clear(); }
}

function push(m, id, x) { const a = m.get(id); if (a) a.push(x); else m.set(id, [x]); }

function fill(pool, arr, place, base) {
  const items = pool.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const L = arr[i];
    if (!L) { if (it.o.visible) it.o.visible = false; continue; }
    const html = L.html != null ? L.html : esc(L.text);
    const cls = base + (L.cls ? ' ' + L.cls : '');
    if (it.html !== html) { it.el.innerHTML = html; it.html = html; }
    if (it.cls !== cls) { it.el.className = cls; it.cls = cls; }
    place(it, L);
    if (!it.o.visible) it.o.visible = true;
  }
}

/** 프로젝트 페이드: 자리(세계 x,z)의 투명도로 흐리게, 0 이면 숨김 */
function fadePool(pool, ctx) {
  const f = ctx.fadeAt;
  for (const it of pool.items) {
    if (!it.o.visible) { if (it._fa) { it._fa = ''; it.el.style.opacity = ''; } continue; }
    const a = f ? f(it.o.position.x, it.o.position.z) : 1;
    if (a <= 0) { it.o.visible = false; continue; }
    const op = a < 1 ? (Math.round(a * 20) / 20).toFixed(2) : '';
    if ((it._fa || '') !== op) { it._fa = op; it.el.style.opacity = op; }
  }
}

function textWidth(s) {
  let w = 20;
  for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11.5 : 6.6;
  return Math.min(222, w);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export { trunc };
