// 흐름(Flow) 표현의 말풍선. agent-flow 의 노드 옆 말풍선(역할 머리표 + 몇 줄): 에이전트 말·사용자 입력·결과.
// CSS2D 풀(BUBBLE.MAX 개) 재사용. 텍스트는 서버가 redact 한 값만(이벤트 text/brief).
import { t as _t } from '../i18n.mjs';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BubbleBook, BUBBLE } from './flow-style.mjs';
import { dodgeBox } from '../label-place.mjs';

const ROLE_LABEL = Object.fromEntries(['text', 'user', 'result', 'error'].map((r) => [r, _t('scene.role.' + r)]));

export class Bubbles {
  constructor(scene, view) {
    this.view = view;
    this.book = new BubbleBook(BUBBLE.MAX);
    this.pool = [];
    this.shown = new Set(); // 지금 말풍선이 떠 있는 노드(라벨의 말 한 줄과 중복 방지)
    for (let i = 0; i < BUBBLE.MAX; i++) {
      const el = document.createElement('div');
      el.className = 'flow-bubble';
      const h = document.createElement('b'), p = document.createElement('p');
      el.append(h, p);
      const o = new CSS2DObject(el);
      o.center.set(0, 0.5);
      o.visible = false;
      scene.add(o);
      this.pool.push({ o, el, h, p, key: null });
    }
  }
  /** view.say(id, text, {type, ok}) 에서 부른다 */
  say(nodeId, text, opts = {}) {
    const t = opts.type;
    if (t !== 'text' && t !== 'user' && t !== 'result') return; // 도구 말풍선은 홀로그램 패널이 맡는다
    const role = t === 'result' && opts.ok === false ? 'error' : t;
    this.book.push(nodeId, role, text, performance.now() / 1000);
  }
  drop(id) { this.book.drop(id); }
  clear() { this.book.clear(); for (const b of this.pool) { b.o.visible = false; b.key = null; } }
  update(now, camera, vpH) {
    const view = this.view;
    const live = this.book.live(now);
    let k = 0;
    const shown = new Set();
    for (const it of live) {
      const v = view.vis.get(it.nodeId);
      if (!v || v.hidden || v.gone || (v.scopeD ?? v.scopeK ?? 1) < 0.5) continue;
      // 화면에서 너무 작은 노드(먼 전체 보기)는 포커스·카메라 대상만
      const vip = it.nodeId === view.focusId || it.nodeId === view.camShotId || it.nodeId === view.hoverId;
      const dd = v.group.position.distanceTo(camera.position);
      const npx = (v.mesh.scale.x * vpH) / (2 * Math.max(0.01, dd) * Math.tan((camera.fov * Math.PI) / 360));
      if (!vip && npx < 16) continue;
      const b = this.pool[k++];
      if (!b) break;
      if (b.key !== it) {
        b.key = it;
        b.h.textContent = ROLE_LABEL[it.role] || '';
        b.p.textContent = it.text;
        b.el.dataset.role = it.role;
        b.w = 0; // 크기는 다음 라벨 패스·비킴 때 잰다
      }
      b.nid = it.nodeId;
      // 노드 오른쪽: 칩 화면 반지름만큼 띄움
      const d = v.group.position.distanceTo(camera.position);
      const px = (v.mesh.scale.x * vpH) / (2 * Math.max(0.01, d) * Math.tan((camera.fov * Math.PI) / 360));
      // 오른쪽(셸) 패널이 떠 있으면 그 바깥으로
      const hasRight = view.holo && view.holo.book.list(it.nodeId).some((e) => e.slot >= 0 && (e.dir === 'shell'));
      const gap = Math.round(Math.min(80, px * 1.6 + 8) + (hasRight ? Math.min(320, (v._holoPx || 0) * 1.85 + 12) : 0));
      if (b.gap !== gap) { b.el.style.marginLeft = gap + 'px'; b.gap = gap; }
      const al = it.alpha * (v.projA ?? 1); // 프로젝트 페이드
      b.el.style.opacity = al < 1 ? String(Math.max(0, Math.round(al * 20) / 20)) : '';
      b.o.position.copy(v.group.position);
      b.o.visible = true;
      shown.add(it.nodeId);
    }
    for (; k < this.pool.length; k++) if (this.pool[k].o.visible) { this.pool[k].o.visible = false; this.pool[k].key = null; }
    this._n = shown.size ? k : 0;
    if (this._n) this._dodge(camera);
    // 말풍선이 생기거나 사라진 노드는 라벨을 다시(말 한 줄을 넣고 빼기)
    for (const id of shown) if (!this.shown.has(id) && view._labelText) { const v = view.vis.get(id); if (v) view._labelText(v); }
    for (const id of this.shown) if (!shown.has(id) && view._labelText) { const v = view.vis.get(id); if (v) view._labelText(v); }
    this.shown = shown;
  }
  /** 말풍선 제자리(비키기 전) 화면 사각형 — 노드 라벨이 이것을 피한다 */
  _rectOf(b, camera, W, H) {
    if (!b.o.visible) return null;
    if (!b.w) { b.w = b.el.offsetWidth || 0; b.hh = b.el.offsetHeight || 0; }
    if (!b.w) return null;
    const v3 = this._v3 || (this._v3 = camera.position.clone());
    v3.copy(b.o.position).project(camera);
    if (v3.z < -1 || v3.z > 1) return null;
    const x = (v3.x * 0.5 + 0.5) * W + (b.gap || 0), y = (-v3.y * 0.5 + 0.5) * H; // 왼쪽 여백(gap)만큼 띄운 자리, 폭은 여백 뺀 상자
    return [x, y - b.hh / 2, x + b.w, y + b.hh / 2];
  }
  baseRects(camera, W, H, out = []) {
    for (let i = 0; i < (this._n || 0); i++) { const r = this._rectOf(this.pool[i], camera, W, H); if (r) out.push(r); }
    return out;
  }
  /** 고정·포커스 라벨처럼 비키지 못한 라벨에 걸친 말풍선은 위아래로 비킨다(라벨은 말풍선 제자리를 이미 피하므로 보통 0) */
  _dodge(camera) {
    const view = this.view;
    if (!view.labelScreenBoxes) return;
    const W = view.container.clientWidth, H = view.container.clientHeight;
    const labs = view.labelScreenBoxes(W, H, this._labs || (this._labs = []));
    for (let i = 0; i < this._n; i++) {
      const b = this.pool[i];
      const r = labs.length ? this._rectOf(b, camera, W, H) : null;
      const dy = r ? dodgeBox(r, labs) ?? 0 : 0;
      if (b.dy !== dy) { b.dy = dy; b.el.style.translate = dy ? `0 ${dy}px` : ''; }
    }
    labs.length = 0;
  }
  dispose() { for (const b of this.pool) { b.o.removeFromParent(); b.el.remove(); } this.pool = []; }
}
