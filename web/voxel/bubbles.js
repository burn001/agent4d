// 말풍선·이름표·방 문패 — CSS2D. DOM 은 미리 만든 풀을 돌려 쓴다(프레임마다 생성 0).
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { placeLabels, textWidth as textPx } from '../label-place.mjs';

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

  /** 말풍선 하나(캐릭터당 1개, 새것이 덮음) */
  say(id, text, { type = 'text', dur = 2.5, now }) {
    const t = trunc(text, 28);
    if (!t) return;
    this.bubbles.set(id, { text: t, type, until: now + dur, born: now });
  }

  clear() { this.bubbles.clear(); for (const p of [this.bpool, this.lpool, this.rpool]) for (const it of p.items) { it.o.visible = false; it.key = null; } }

  /**
   * ctx = { now, narrow, focusId, hoverId, posOf(id)→{x,y,z}|null, labels:[{id,text,cls,x,y,z}], rooms:[{id,text,cls,x,z}] }
   */
  update(ctx) {
    const { now } = ctx;
    // 말풍선: 만료 제거 → 포커스 > 최근 순으로 남김
    const list = [];
    for (const [id, b] of this.bubbles) {
      if (now > b.until) { this.bubbles.delete(id); continue; }
      const p = ctx.posOf(id); // 공유 임시 객체 → 값만 복사
      if (!p) continue;
      list.push([id, b, p.x, p.y, p.z]);
    }
    list.sort((a, b) => ((b[0] === ctx.focusId) - (a[0] === ctx.focusId)) || (b[1].born - a[1].born));
    const max = ctx.narrow ? BUBBLE_MAX_NARROW : BUBBLE_MAX;
    const items = this.bpool.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const e = i < max ? list[i] : null;
      if (!e) { if (it.o.visible) it.o.visible = false; it.key = null; continue; }
      const [id, b, px, py, pz] = e;
      const html = esc(b.text);
      const cls = 'vx-bubble t-' + b.type + (id === ctx.focusId ? ' focus' : '') + (b.until - now < 0.35 ? ' out' : '');
      if (it.html !== html) { it.el.innerHTML = html; it.html = html; }
      if (it.cls !== cls) { it.el.className = cls; it.cls = cls; }
      it.o.position.set(px, py + 0.55, pz);
      it.key = id;
      it.w = textWidth(b.text);
      if (!it.o.visible) it.o.visible = true;
    }
    if (this._placed) this._placed.length = 0;
    if (ctx.camera) this._declutter(ctx, Math.min(max, list.length));
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
    const placed = placeLabels(cands, discs, { shifts: VX_SHIFTS, farShifts: VX_FAR, bounds: [0, W], rects });
    for (const c of cands) {
      const it = items[c.i], r = placed.get(c.id);
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
  _declutter(ctx, n) {
    const W = ctx.width, H = ctx.height, cam = ctx.camera;
    const items = this.bpool.items;
    const placed = this._placed || (this._placed = []);
    placed.length = 0;
    const v = this._v || (this._v = cam.position.clone());
    for (let i = 0; i < n; i++) {
      const it = items[i];
      v.copy(it.o.position).project(cam);
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      const w = it.w, h = 24;
      let off = 0;
      for (let k = 0; k < 5; k++) {
        const top = y - h - off, bot = y - off;
        let hit = false;
        for (let j = 0; j < placed.length; j += 4) {
          if (x - w / 2 < placed[j + 2] && x + w / 2 > placed[j] && top < placed[j + 3] && bot > placed[j + 1]) { hit = true; break; }
        }
        if (!hit) break;
        off += h + 3;
      }
      placed.push(x - w / 2, y - h - off, x + w / 2, y - off);
      if (it.off !== off) { it.off = off; it.el.style.transform = off ? `translateY(${-off}px)` : ''; }
    }
  }

  dispose() { this.bpool.dispose(); this.lpool.dispose(); this.rpool.dispose(); this.bubbles.clear(); }
}

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
