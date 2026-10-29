// 신호 열화 2차 — 사람이 읽는 HTML 글자(노드 라벨·말풍선·이름표·실황 패널 줄)를 그 세션 열화 세기 D 만큼 깨뜨린다.
//  · 글자 깨짐: 글 하나만 든 잎 요소(b·small·span…)를 잠깐(0.1～0.4초) `▒`·`?` 등이 섞인 모습으로 덮었다 되돌린다.
//    DOM 노드는 넣거나 빼지 않는다 — 요소에 data-ccv-g(깨진 글)와 .ccv-gx 를 붙이면 CSS 가 원래 글자를 투명하게(text-fill)
//    하고 ::after(content: attr(data-ccv-g) / "" — 대체 글 빈 문자열이라 스크린리더는 읽지 않음)로 덮는다.
//    textContent·접근성 이름은 원문 그대로. (처음엔 span 을 끼워 넣었는데 실황 패널 줄 400개에서 300노드 p95 18→35ms 로 무거웠다)
//  · 지속 표시: 요소에 data-ccv-deg="1|2|3" (CSS: 색 갈라짐·번짐·흔들림, 움직임 줄이기면 흔들림 없음).
//  · 비용: 열화가 없으면 tick 이 바로 돌아감(표시 해제 한 번 뒤 0). span 은 미리 만든 풀(SLOTS)을 돌려 쓴다.
import { DEG, degOf, textGlitchPlan, glitchStr } from './degrade-core.mjs';

const SLOTS = 14;
const SCAN_MS = 400;          // 대상 요소 다시 모으기
const PANEL_ROWS = 18;        // 실황 패널은 맨 위(최신) 몇 줄만
export const degClass = (D) => (D >= 0.8 ? 3 : D >= 0.5 ? 2 : D >= 0.22 ? 1 : 0);

export class TextGlitch {
  constructor() {
    this.slots = [];
    for (let i = 0; i < SLOTS; i++) this.slots.push({ leaf: null, el: null, until: 0 });
    this.els = []; this.ds = []; this.ids = [];   // 대상(재사용 배열)
    this.marked = new Set();                       // data-ccv-deg 를 붙인 요소
    this._keep = new Set();
    this.lastScan = 0; this.lastT = 0;
    this.stat = { glitches: 0, active: 0, targets: 0, marked: 0 };
    this._seed = 1;
  }

  _restore(s) {
    if (s.leaf) { s.leaf.classList.remove('ccv-gx', 'ccv-gxr'); delete s.leaf.dataset.ccvG; }
    s.leaf = null; s.el = null; s.until = 0;
  }
  restoreAll() { for (const s of this.slots) if (s.leaf) this._restore(s); }
  _unmarkAll() { for (const el of this.marked) delete el.dataset.ccvDeg; this.marked.clear(); }

  /** 대상 모으기: 렌더러 라벨(vis.labelEl)·복셀 이름표/말풍선 풀·실황 패널 줄 */
  _scan(view, store, panelEl) {
    const els = this.els, ds = this.ds, ids = this.ids;
    els.length = 0; ds.length = 0; ids.length = 0;
    const push = (el, id) => { if (!el || !id) return; const d = degOf(id); if (d <= 0) return; els.push(el); ds.push(d); ids.push(id); };
    if (view && view.vis) for (const v of view.vis.values()) if (v.labelOn && v.labelEl && !v.hidden) push(v.labelEl, v.id || (v.node && v.node.id));
    const bub = view && view.bubbles;
    if (bub && bub.lpool) for (const p of [bub.lpool, bub.bpool]) if (p) for (const it of p.items) if (it.o.visible && it.key) push(it.el, it.key);
    if (bub && bub.els && view.quips) for (const b of bub.els) if (b.id && b.el.isConnected) push(b.p, b.id); // 복셀 2D 생각·말풍선도 같은 규칙
    if (panelEl) { let i = 0; for (let ln = panelEl.firstElementChild; ln && i < PANEL_ROWS; ln = ln.nextElementSibling, i++) if (!ln.classList.contains('k-hidden') && !ln.classList.contains('k-scope')) push(ln, ln.dataset.node); }
    // 지속 표시(data-ccv-deg)
    const keep = this._keep; keep.clear();
    for (let i = 0; i < els.length; i++) {
      const el = els[i], c = degClass(ds[i]);
      if (!c) continue;
      keep.add(el);
      const cs = String(c);
      if (el.dataset.ccvDeg !== cs) el.dataset.ccvDeg = cs;
      this.marked.add(el);
    }
    for (const el of this.marked) if (!keep.has(el)) { delete el.dataset.ccvDeg; this.marked.delete(el); }
    this.stat.targets = els.length; this.stat.marked = this.marked.size;
  }

  _pickLeaf(el) {
    // 글 하나만 든 잎 요소 중 하나(저수지 표본). 요소 자신이 잎이면 그것
    let n = 0, pick = null;
    const consider = (e) => { const t = e.firstChild; if (t && t === e.lastChild && t.nodeType === 3 && t.data.trim().length >= 2) { n++; if (Math.random() * n < 1) pick = e; } };
    consider(el);
    const all = el.getElementsByTagName('*');
    for (let i = 0; i < all.length && i < 40; i++) consider(all[i]);
    return pick;
  }

  _glitch(el, D, nowMs) {
    let s = null;
    for (const x of this.slots) { if (x.el === el) return false; if (!s && !x.leaf) s = x; } // 한 요소에 하나만
    if (!s) return false;
    const leaf = this._pickLeaf(el);
    if (!leaf || leaf.classList.contains('ccv-gx')) return false;
    const plan = textGlitchPlan(D);
    leaf.dataset.ccvG = glitchStr(leaf.firstChild.data, plan.frac, (this._seed = (this._seed * 1103515245 + 12345) | 0));
    // 덮개(::after) 기준 상자: 위치 지정 안 된 요소만 relative 로(이미 absolute 등이면 그대로). 요소마다 한 번 잰다
    if (leaf._ccvStatic == null) leaf._ccvStatic = getComputedStyle(leaf).position === 'static';
    leaf.classList.add('ccv-gx');
    if (leaf._ccvStatic) leaf.classList.add('ccv-gxr');
    s.leaf = leaf; s.el = el; s.until = nowMs + plan.ms * (0.7 + Math.random() * 0.6);
    this.stat.glitches++;
    return true;
  }

  /**
   * 매 프레임. on=false(꺼짐·열화 없음)면 깨진 것을 되돌리고 표시를 지운 뒤 바로 돌아감
   * @param {number} nowMs
   * @param {{view, store, panelEl, paused?:boolean}} o
   */
  tick(nowMs, { view, store, panelEl, paused = false }) {
    let active = 0;
    for (const s of this.slots) if (s.leaf) { if (nowMs >= s.until || !DEG.on || !s.leaf.isConnected) this._restore(s); else active++; }
    this.stat.active = active;
    if (!DEG.on) { if (this.marked.size) this._unmarkAll(); this.els.length = 0; this.lastScan = 0; this.stat.marked = 0; this.stat.targets = 0; return; }
    if (nowMs - this.lastScan > SCAN_MS) { this.lastScan = nowMs; this._scan(view, store, panelEl); }
    const dt = Math.min(0.25, Math.max(0, (nowMs - (this.lastT || nowMs)) / 1000));
    this.lastT = nowMs;
    if (DEG.reduced || paused || !dt) return; // 움직임 줄이기·일시정지: 깜빡이는 깨짐 없음(지속 표시만)
    const els = this.els, ds = this.ds;
    for (let i = 0; i < els.length; i++) {
      const d = degOf(this.ids[i]) || ds[i]; // 버스트 중이면 더 세게
      const plan = textGlitchPlan(d);
      if (Math.random() < plan.rate * dt && els[i].isConnected) this._glitch(els[i], d, nowMs);
    }
  }

  dispose() { this.restoreAll(); this._unmarkAll(); }
}
